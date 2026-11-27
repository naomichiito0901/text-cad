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

// ---- 形状の生成 ----------------------------------------------------------------
// main スレッドの kernelModelOf() が作った記述 (箱・円柱・穴・長穴) から、replicad の立体を作る。
const M = 1; // 穴の工具を材料の外へはみ出させる量 (mm)

// STEP は ASCII のみ。 日本語などの名前は \X2\....\X0\ に直す
function stepAscii(text) {
  let out = '', buf = '';
  const flush = () => { if (buf) { out += `\\X2\\${buf}\\X0\\`; buf = ''; } };
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x80) { flush(); out += ch; } else if (c <= 0xffff) buf += c.toString(16).toUpperCase().padStart(4, '0'); else buf += '003F';
  }
  flush();
  return out;
}

function dedupe(pts) {
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9);
}

// 止まり・座ぐり・皿穴・貫通の穴: 断面 (半径, 高さ) を Z 軸まわりに回した工具
function revCutter(h, zTop, zBot) {
  const { pts, through } = h;
  const P = [[0, zTop + M], [pts[0].r, zTop + M]];
  pts.forEach((q) => P.push([q.r, q.z]));
  const last = pts[pts.length - 1];
  if (through) P.push([last.r, zBot - M], [0, zBot - M]); else P.push([0, last.z]);
  const q = dedupe(P);
  let pen = R.draw(q[0]);
  for (let i = 1; i < q.length; i++) pen = pen.lineTo(q[i]);
  return pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]).translate(h.x, h.y, 0);
}

// 斜め穴: 上面の中心 (x,y) から下へ向かって dir の向きに angle 度傾く円柱
function tiltCutter(t, zTop, zBot) {
  const th = (t.angle * Math.PI) / 180, H = zTop - zBot, r = t.d / 2;
  const L = H / Math.cos(th) + 2 * (r * Math.tan(th) + 2 * M);
  const zc = (zTop + zBot) / 2, k = (zTop - zc) * Math.tan(th);
  return R.drawCircle(r).sketchOnPlane('XY', -L / 2).extrude(L)
    .rotate(t.angle, [0, 0, 0], [t.dir[1], -t.dir[0], 0])
    .translate(t.x + t.dir[0] * k, t.y + t.dir[1] * k, zc);
}

function slotCutter(sl, zTop, zBot) {
  // 向きが y のときも、x の形を 90 度回して作る (幅 = 半径の 2 倍の矩形を縦長で作ると、長さ 0 の辺ができて失敗する)
  let d = R.drawRoundedRectangle(sl.len, sl.w, sl.w / 2);
  if (sl.dir === 'y') d = d.rotate(90);
  return d.sketchOnPlane('XY', zBot - M).extrude(zTop - zBot + 2 * M).translate(sl.cx, sl.cy, 0);
}

function makeSolid(m) {
  let s;
  if (m.kind === 'cyl') {
    s = R.drawCircle(m.r).sketchOnPlane('XY', m.z0).extrude(m.z1 - m.z0).translate(m.cx, m.cy, 0);
    const top = (e) => e.inPlane('XY', m.z1), bot = (e) => e.inPlane('XY', m.z0);
    if (m.ft) s = s.fillet(m.ft, top);
    else if (m.ct) s = s.chamfer(m.ct, top);
    if (m.fb) s = s.fillet(m.fb, bot);
    else if (m.cb) s = s.chamfer(m.cb, bot);
    return s;
  }
  const w = m.x1 - m.x0, d = m.y1 - m.y0;
  s = (m.cr ? R.drawRoundedRectangle(w, d, m.cr) : R.drawRectangle(w, d)).sketchOnPlane('XY', m.z0).extrude(m.z1 - m.z0).translate((m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, 0);
  if (m.ct) s = s.chamfer(m.ct, (e) => e.inPlane('XY', m.z1));
  if (m.cb) s = s.chamfer(m.cb, (e) => e.inPlane('XY', m.z0));
  for (const h of m.holes) s = s.cut(h.rev ? revCutter(h.rev, m.z1, m.z0) : tiltCutter(h.tilt, m.z1, m.z0));
  for (const sl of m.slots) s = s.cut(slotCutter(sl, m.z1, m.z0));
  return s;
}

function isValid(shape) {
  const oc = R.getOC();
  return new oc.BRepCheck_Analyzer(shape.wrapped, true, false).IsValid();
}

// ---- 操作 (ops) ----------------------------------------------------------------
const ops = {
  // 立体の記述から STEP / STL と、立体ごとの体積・表面積・面の数・有効性を返す
  async buildModel({ model }) {
    const shapes = model.map((m) => ({ name: m.name, shape: makeSolid(m) }));
    const solids = shapes.map(({ name, shape }) => ({
      name, volume: R.measureVolume(shape), area: R.measureArea(shape), faces: shape.faces.length, valid: isValid(shape),
    }));
    const step = stepAscii(await R.exportSTEP(shapes.map(({ shape, name }) => ({ shape, name }))).text());
    const stl = await R.compoundShapes(shapes.map((x) => x.shape)).blobSTL({ binary: false, tolerance: 0.01, angularTolerance: 0.1 }).text();
    return { step, stl, solids };
  },
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
