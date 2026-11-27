// 計算エンジン (OpenCascade WASM + replicad) の読み込みと動作確認。
//  - offline : dist-offline/index.html を file:// で開く (フォルダ配布。ダブルクリック相当)
//  - web     : dist/ を HTTP で配信して開く (GitHub Pages 相当)
//  - web-file: Web 版を file:// で開いた場合は、エラーにならず案内を出して旧実装で動くこと
// 確認する内容: 読み込み中も YAML を編集できる / 外部への通信が無い / Worker で計算できる /
//   STEP・STL・体積が出る (STEP・STL は validate5.py で OpenCascade と理論値に照合する)
const { launch } = require('./browser');
const http = require('http');
const fs = require('fs');
const path = require('path');

const S = path.join(process.env.CAD_OUT || '/tmp/cad-out', '/');
fs.mkdirSync(S, { recursive: true });
const root = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.gz': 'application/gzip', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8' };

function serve(dir) {
  const srv = http.createServer((req, res) => {
    const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+$/, '/index.html'));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const buf = fs.readFileSync(f);
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'content-length': buf.length });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const results = [];
(async () => {
  const b = await launch();
  const srv = await serve(path.join(root, 'dist'));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const targets = [
    ['offline', 'file://' + path.join(root, 'dist-offline/index.html')],
    ['web', base + 'index.html'],
    ['web-slow', base + 'index.html', true], // WASM の取得を遅らせ、読み込み中の編集を確認する
    ['web-file', 'file://' + path.join(root, 'dist/index.html')],
  ];
  const errs = [];
  for (const [name, url, slow] of targets) {
    const p = await (await b.newContext({ viewport: { width: 1300, height: 800 }, acceptDownloads: true })).newPage();
    const external = [];
    p.on('pageerror', (e) => errs.push(`[${name}] pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(`[${name}] console: ${m.text()}`); });
    p.on('request', (r) => { const u = r.url(); if (!/^(file:|blob:|data:)/.test(u) && !u.startsWith(base)) external.push(u); });
    if (slow) await p.route('**/kernel/occt.wasm.gz', async (route) => { if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 4000)); route.continue(); });
    const t0 = Date.now();
    await p.goto(url);
    // 読み込み中でも YAML を編集でき、旧実装の描画が更新される
    await p.click('[data-step="2"]');
    await p.fill('#editor', (await p.inputValue('#editor')).replace(/size: \[100, 50, 10\]/, 'size: [110, 50, 10]'));
    await p.waitForTimeout(700);
    // 編集が反映されたかは、表示 (WebGL が無いと 3D 表示は中止される) ではなく、内部のモデルで確かめる
    const editWorks = await p.evaluate(() => JSON.stringify(window.__cad.wf.solids).includes('"x1":110'));
    const phaseAtEdit = await p.evaluate(() => window.__cad.kernel.state.phase);
    await p.waitForFunction(() => ['ready', 'error'].includes(window.__cad.kernel.state.phase), null, { timeout: 120000 });
    const ms = Date.now() - t0;
    const st = await p.evaluate(() => ({ ...window.__cad.kernel.state }));
    const label = await p.textContent('#kernel-status');
    const r = { name, phaseAtEdit, phase: st.phase, ms, label, externalRequests: external.length, editWorks };
    if (name === 'web-file') {
      // Web 版を file:// で開いた場合: 計算エンジンは使えないが、アプリは旧実装で動く
      r.ok = st.phase === 'error' && /使えません/.test(label) && r.editWorks;
    } else {
      r.ok = st.phase === 'ready' && external.length === 0 && (!slow || (phaseAtEdit === 'loading' && r.editWorks));
      if (r.ok) {
        const out = await p.evaluate(() => window.__cad.kernel.call('selfTest'));
        r.hlr = out.hlr;
        for (const k of ['plate', 'knob']) {
          fs.writeFileSync(S + `kernel_${name}_${k}.step`, out[k].step);
          fs.writeFileSync(S + `kernel_${name}_${k}.stl`, out[k].stl);
          r[k + 'Volume'] = out[k].volume;
        }
        r.ok = r.hlr === 'function' && r.plateVolume > 0 && r.knobVolume > 0;
      }
    }
    results.push(r);
    console.log(JSON.stringify(r));
    await p.context().close();
  }
  console.log('all ok:', results.every((r) => r.ok));
  if (!results.every((r) => r.ok)) errs.push('計算エンジンの確認に失敗');
  console.log('ERRORS', errs);
  srv.close();
  await b.close();
})();
