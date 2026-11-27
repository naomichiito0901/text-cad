// 計算エンジン (OpenCascade WASM + replicad) の読み込みと呼び出し (メインスレッド側)。
// 計算は Web Worker で行うので、読み込み中も画面 (YAML の編集・旧実装の描画) は止まらない。
// 配布は 2 通り (ビルド時に window.__KERNEL_MODE が決まる):
//   web     : kernel/ フォルダの 3 ファイルを fetch で読む (GitHub Pages)。 進捗は読み込んだバイト数で出す
//   offline : kernel-data.js を <script> で読む (フォルダ配布。 file:// では fetch が使えないため)
// どちらも外部 CDN は使わず、同じ場所に置いたファイルだけを読む。
const Kernel = (() => {
  const mode = window.__KERNEL_MODE || 'web';
  const listeners = [];
  let state = { phase: 'idle', pct: 0, text: '計算エンジン: 待機中' };
  let worker = null;
  let send = null;
  let threadMode = 'none';
  let nextId = 1;
  const pending = new Map();
  let started = false;
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  ready.catch(() => {}); // 使われなかったときに未処理の拒否として報告されないように

  const set = (phase, pct, text) => { state = { phase, pct, text }; listeners.forEach((f) => f(state)); };

  // 進捗付きで取得する (Content-Length が分かれば % を出す)
  async function fetchBuf(url, onBytes) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} を取得できません (${res.status})`);
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length; onBytes(value.length);
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out.buffer;
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error(`${src} を読み込めません`));
      document.head.appendChild(s);
    });
  }

  function b64ToBuf(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  async function sources() {
    if (mode === 'offline') {
      set('loading', 5, '計算エンジン: 読み込み中');
      await loadScript('kernel-data.js');
      set('loading', 50, '計算エンジン: 展開中');
      const K = window.__KERNEL_DATA;
      const out = { wasm: b64ToBuf(K.wasmGzB64), glue: K.glue, replicad: K.replicad };
      window.__KERNEL_DATA = null; // メモリを解放する
      return out;
    }
    if (location.protocol === 'file:') {
      throw new Error('このファイルを直接開いた場合は計算エンジンを読めません。 フォルダ配布版 (オフライン版) を使うか、Web サイトから開いてください');
    }
    set('loading', 0, '計算エンジン: 読み込み中 0%');
    // 3 ファイルの合計バイト数が分からないので、先頭リクエストで各サイズを調べる
    const urls = ['kernel/occt.wasm.gz', 'kernel/occt.js', 'kernel/replicad.js'];
    const sizes = await Promise.all(urls.map((u) => fetch(u, { method: 'HEAD' }).then((r) => +r.headers.get('content-length') || 0).catch(() => 0)));
    const total = sizes.reduce((a, b) => a + b, 0);
    let got = 0;
    const onBytes = (n) => {
      got += n;
      const pct = total ? Math.min(95, Math.round((got / total) * 95)) : 0;
      set('loading', pct, `計算エンジン: 読み込み中 ${total ? pct + '%' : ''}`.trim());
    };
    const [wasm, glue, replicad] = await Promise.all([
      fetchBuf(urls[0], onBytes),
      fetchBuf(urls[1], onBytes).then((b) => new TextDecoder().decode(b)),
      fetchBuf(urls[2], onBytes).then((b) => new TextDecoder().decode(b)),
    ]);
    return { wasm, glue, replicad };
  }

  // Safari (WebKit) は file:// で Blob から Worker を作れない。 それ以外は Worker を使う
  function useWorker() {
    const safari = /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent);
    const forced = /[?&]kernel=main(&|$)/.test(location.search); // ?kernel=main で同じスレッドで動かす (確認用)
    return typeof Worker !== 'undefined' && !forced && !(location.protocol === 'file:' && safari);
  }

  async function start() {
    if (started) return ready;
    started = true;
    try {
      const src = await sources();
      const code = document.getElementById('kernel-worker-src').textContent;
      const onMsg = (e) => {
        const m = e.data;
        if (m.type === 'progress') set('loading', m.stage === '展開中' ? 96 : 98, `計算エンジン: ${m.stage}`);
        else if (m.type === 'ready') { set('ready', 100, '計算エンジン: 準備完了'); resolveReady(true); }
        else if (m.type === 'fail') fail(new Error(m.error));
        else if (m.type === 'result') {
          const p = pending.get(m.id); pending.delete(m.id);
          if (p) (m.ok ? p.res(m.result) : p.rej(new Error(m.error)));
        }
      };
      if (useWorker()) {
        worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
        worker.onmessage = onMsg;
        worker.onerror = (e) => fail(new Error(e.message || 'Worker のエラー'));
        send = (m, tr) => worker.postMessage(m, tr || []);
        threadMode = 'worker';
      } else {
        // Safari は file:// で Blob の Worker を作れない。 同じスレッドで動かす (計算中は画面が止まる)
        const fake = { onmessage: null, postMessage: (m) => setTimeout(() => onMsg({ data: m }), 0) };
        new Function('self', code)(fake);
        send = (m) => setTimeout(() => fake.onmessage({ data: m }), 0);
        threadMode = 'main';
      }
      send({ type: 'init', wasm: src.wasm, glue: src.glue, replicad: src.replicad }, [src.wasm]);
    } catch (err) { fail(err); }
    return ready;
  }

  // 失敗しても画面は旧実装のまま使える。 コンソールの error にはせず、状態表示にだけ出す
  function fail(err) {
    set('error', 0, '計算エンジン: 使えません');
    state.detail = String((err && err.message) || err);
    listeners.forEach((f) => f(state));
    rejectReady(err);
    pending.forEach((p) => p.rej(err)); pending.clear();
  }

  // 3D 表示・出力のように計算エンジンを使う処理は、これで準備完了を待つ
  async function call(op, args) {
    await ready;
    return new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      send({ type: 'call', id, op, args });
    });
  }

  return {
    mode,
    start,
    ready,
    call,
    get state() { return state; },
    get threadMode() { return threadMode; },
    onStatus(f) { listeners.push(f); f(state); },
  };
})();
