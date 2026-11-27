// 計算エンジン (OpenCascade WASM + replicad) を動かす Web Worker。
// このファイルは文字列として index.html に埋め込まれ、Blob から Worker として起動される。
// (file:// でも動くよう、別ファイルの Worker は使わない)
// Worker を作れない環境 (Safari の file://) では、この全体を関数として同じスレッドで実行する。
// そのため `self` だけを使い、`self.replicad` のような Worker 固有の参照は避ける。
//
// メッセージ:
//   main → worker  {type:'init', wasm: ArrayBuffer, glue: string, replicad: string}
//   main → worker  {type:'call', id, op, args}
//   worker → main  {type:'progress', stage}
//   worker → main  {type:'ready'} / {type:'fail', error}
//   worker → main  {type:'result', id, ok, result | error}
'use strict';

const post = (m, tr) => self.postMessage(m, tr || []);

// WASM は gzip で配る。 先頭の 2 バイトで見分け、サーバーが既に展開して返した場合 (生の WASM) もそのまま使う
async function gunzipIfNeeded(buf) {
  const h = new Uint8Array(buf, 0, 4);
  if (h[0] === 0x1f && h[1] === 0x8b) {
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
    return new Uint8Array(await ds.arrayBuffer());
  }
  return new Uint8Array(buf);
}

let R = null; // replicad

// ---- 操作 (ops) ----------------------------------------------------------------
// 基盤の段階では、計算エンジンの動作確認 (selfTest) だけを置く。 形状の生成は次の段階で追加する。
const ops = {
  // 動作確認: 体積を理論値と比較できる 2 つの立体を作り、STEP / STL / 体積を返す
  async selfTest() {
    const out = {};
    // 60 x 40 x 20 の箱 (XY は中心が原点) に φ8 の貫通穴
    const box = R.makeBaseBox(60, 40, 20);
    const hole = R.drawCircle(4).sketchOnPlane('XY', -1).extrude(22);
    const plate = box.cut(hole);
    // φ20 x 30 の円柱の上端に R3 のフィレット
    const cyl = R.drawCircle(10).sketchOnPlane('XY').extrude(30);
    const knob = cyl.fillet(3, (e) => e.inPlane('XY', 30));
    for (const [name, shape] of [['plate', plate], ['knob', knob]]) {
      out[name] = {
        volume: R.measureVolume(shape),
        step: await shape.blobSTEP().text(),
        stl: await shape.blobSTL({ binary: false, tolerance: 0.01, angularTolerance: 0.1 }).text(),
      };
    }
    out.hlr = typeof R.makeProjectedEdges; // 隠線処理 (HLR) が使えること
    return out;
  },
  async ping() { return 'pong'; },
};

async function init({ wasm, glue, replicad }) {
  post({ type: 'progress', stage: '展開中' });
  const bin = await gunzipIfNeeded(wasm);
  post({ type: 'progress', stage: '初期化中' });
  (0, eval)(glue); // 起動用 JS (補正済み)。 globalThis.__OCModule を定義する
  const OC = await globalThis.__OCModule({
    // WASM は同梱のバイナリを使い、外部への取得は一切行わない
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(bin, imports).then((r) => done(r.instance, r.module));
      return {};
    },
  });
  (0, eval)(replicad); // UMD。 self.replicad を定義する
  R = globalThis.replicad;
  R.setOC(OC);
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try { await init(m); post({ type: 'ready' }); } catch (err) { post({ type: 'fail', error: String((err && err.message) || err) }); }
  } else if (m.type === 'call') {
    try {
      if (!ops[m.op]) throw new Error('未対応の操作: ' + m.op);
      post({ type: 'result', id: m.id, ok: true, result: await ops[m.op](m.args) });
    } catch (err) {
      post({ type: 'result', id: m.id, ok: false, error: String((err && err.message) || err) });
    }
  }
};
