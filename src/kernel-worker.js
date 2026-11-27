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

// 部品 (組立では inst が同じ立体のまとまり。単品モードは全体で 1 つ) ごとに、立体を 1 つに融合する。
// 面で接しているだけの立体 (板の上面に載せたボスなど) も、つながっているものとして融合する。
// 離れていて融合できない立体が部品にあるとき、融合した結果は複数の立体を持つ (別の立体のまま出力する)。
function partGroups(model) {
  const groups = new Map();
  model.forEach((m, i) => {
    const key = m.inst !== undefined ? 'inst:' + m.inst : 'single';
    if (!groups.has(key)) groups.set(key, { inst: m.inst, idx: [] });
    groups.get(key).idx.push(i);
  });
  return [...groups.values()].map((g) => {
    const names = g.idx.map((i) => model[i].name);
    // 部品の名前: メインスレッドが付けた表示名 (YAML の部品名・title)。 無ければ、組立は配置の id、単品は立体の名前をつなぐ
    const label = model[g.idx[0]].part;
    const name = label || (g.inst !== undefined ? String(g.inst) : names.length <= 3 ? names.join('+') : `${names[0]} 他${names.length - 1}`);
    return { name, key: g.inst !== undefined ? g.inst : null, idx: g.idx, members: names };
  });
}
// test: テスト用の指定 ({ failFuse: true } で融合を失敗させ、失敗の理由の表示を確かめる)
function fuseParts(model, shapes, test) {
  return partGroups(model).map((g) => {
    let shape = shapes[g.idx[0]];
    try {
      if (test && test.failFuse) throw new Error('テスト用に失敗させました');
      for (const i of g.idx.slice(1)) shape = shape.fuse(shapes[i]);
    } catch (e) {
      throw new Error(`部品「${g.name}」の立体を融合できませんでした (${(e && e.message) || e})`);
    }
    return { name: g.name, key: g.key, members: g.members, idx: g.idx, shape, solids: shape.solids.length };
  });
}

// STEP の形式。 replicad の書き出しは write.step.schema を 5 (AP242) に固定して設定するので、その設定の値だけ差し替える。
// OpenCascade の値: 4 = AP214 (IS、AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 })、5 = AP242
const STEP_SCHEMA = { AP242: 5, AP214: 4 };
async function exportStepAs(shapes, format) {
  const want = STEP_SCHEMA[format];
  if (!want) throw new Error(`STEP の形式は AP242 か AP214 です (${format})`);
  const IS = R.getOC().Interface_Static, orig = IS.SetIVal;
  // 差し替えた関数の中で、元の関数を一時的に戻して呼ぶ (embind の関数は、自分自身に紐づく情報を使うため)
  const patched = function (k, v) { IS.SetIVal = orig; try { return orig.call(IS, k, k === 'write.step.schema' ? want : v); } finally { IS.SetIVal = patched; } };
  IS.SetIVal = patched;
  try { return await R.exportSTEP(shapes.map(({ shape, name }) => ({ shape, name }))).text(); } finally { IS.SetIVal = orig; }
}

function isValid(shape) {
  const oc = R.getOC();
  return new oc.BRepCheck_Analyzer(shape.wrapped, true, false).IsValid();
}

// 投影した辺を、図面用のデータにする (直線 / 円 / 円弧 / その他は折れ線)。 曲線が円弧にぴったり合うときは、円弧にする (円筒の丸みの輪郭など)
function edgeData(e) {
  const P = (t) => { const v = e.pointAt(t); return [v.x, v.y]; };
  const a = P(0), b = P(1), m = P(0.5), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const type = e.geomType;
  if (type === 'LINE') return len > 1e-9 ? { k: 'line', a, b } : null;
  const closed = len < 1e-6, three = closed ? [a, P(0.25), m] : [a, m, b];
  const [[x1, y1], [x2, y2], [x3, y3]] = three, d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) > 1e-9) {
    const ux = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / d;
    const uy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / d;
    const r = Math.hypot(x1 - ux, y1 - uy);
    if (r < 1e5 && [0.1, 0.2, 0.35, 0.65, 0.8, 0.9].every((t) => { const q = P(t); return Math.abs(Math.hypot(q[0] - ux, q[1] - uy) - r) < 1e-6 * Math.max(1, r); })) {
      if (closed) return { k: 'circle', c: [ux, uy], r };
      const ang = (p) => Math.atan2(p[1] - uy, p[0] - ux) * 180 / Math.PI, wrap = (x) => ((x + 540) % 360) - 180;
      const A0 = ang(a), Am = ang(m), A1 = ang(b), ccw = wrap(Am - A0) + wrap(A1 - Am) > 0;
      const [s0, s1] = ccw ? [A0, A1] : [A1, A0];
      const sweep = ((s1 - s0) % 360 + 360) % 360 || 360, n0 = wrap(s0); // 始まりの角度は -180〜180 度、終わりは始まりから反時計回りに
      return { k: 'arc', c: [ux, uy], r, a0: n0, a1: n0 + sweep };
    }
  }
  const n = 48;
  return { k: 'poly', type, pts: Array.from({ length: n + 1 }, (_, i) => P(i / n)) };
}

// 投影した線の整理: (1) 真横から見た円などが作る、往復する曲線を 1 本の線にする (2) 重なる直線をまとめる
// (3) 見える線と重なる隠れ線を除く (見える線を優先する。 裏の面の辺が表の辺と重なる場合など)
function normalizeView(v) {
  const R4 = (x) => Math.round(x * 1e4) / 1e4;
  const collapse = (e) => {
    if (e.k !== 'poly') return e;
    const [p0] = e.pts, q = e.pts.find((p) => Math.hypot(p[0] - p0[0], p[1] - p0[1]) > 1e-9);
    if (!q) return null;
    const L = Math.hypot(q[0] - p0[0], q[1] - p0[1]), d = [(q[0] - p0[0]) / L, (q[1] - p0[1]) / L];
    if (!e.pts.every((p) => Math.abs((p[0] - p0[0]) * d[1] - (p[1] - p0[1]) * d[0]) < 1e-6)) return e;
    const ts = e.pts.map((p) => (p[0] - p0[0]) * d[0] + (p[1] - p0[1]) * d[1]), a = Math.min(...ts), b = Math.max(...ts);
    return b - a < 1e-9 ? null : { k: 'line', a: [p0[0] + d[0] * a, p0[1] + d[1] * a], b: [p0[0] + d[0] * b, p0[1] + d[1] * b] };
  };
  const lineKey = (e) => {
    let dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1]; const L = Math.hypot(dx, dy); dx /= L; dy /= L;
    if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
    return { key: `${R4(Math.atan2(dy, dx))}:${R4(-dy * e.a[0] + dx * e.a[1])}`, d: [dx, dy], t: [e.a[0] * dx + e.a[1] * dy, e.b[0] * dx + e.b[1] * dy].sort((p, q) => p - q) };
  };
  const mergeIv = (iv) => { iv.sort((p, q) => p[0] - q[0]); const o = []; iv.forEach((q) => { if (o.length && q[0] <= o[o.length - 1][1] + 1e-7) o[o.length - 1][1] = Math.max(o[o.length - 1][1], q[1]); else o.push(q.slice()); }); return o; };
  const subIv = (iv, cut) => { let cur = iv; cut.forEach(([a, b]) => { const nx = []; cur.forEach(([p0, p1]) => { if (b <= p0 + 1e-7 || a >= p1 - 1e-7) nx.push([p0, p1]); else { if (a > p0 + 1e-7) nx.push([p0, a]); if (b < p1 - 1e-7) nx.push([b, p1]); } }); cur = nx; }); return cur; };
  const group = (list) => { // 直線: 同じ直線上の区間にまとめる
    const g = new Map(), rest = [];
    list.map(collapse).filter(Boolean).forEach((e) => {
      if (e.k !== 'line') { rest.push(e); return; }
      const { key, d, t } = lineKey(e);
      if (!g.has(key)) g.set(key, { d, o: e.a, iv: [] });
      g.get(key).iv.push(t);
    });
    g.forEach((x) => { x.iv = mergeIv(x.iv); });
    return { g, rest };
  };
  const vis = group(v.visible), hid = group(v.hidden);
  const lines = (G, cutBy) => {
    const out = [];
    G.g.forEach((x, key) => {
      const cut = cutBy && cutBy.g.get(key) ? cutBy.g.get(key).iv : [];
      subIv(x.iv, cut).forEach(([a, b]) => { if (b - a > 1e-6) { const t0 = x.o[0] * x.d[0] + x.o[1] * x.d[1]; out.push({ k: 'line', a: [x.o[0] + x.d[0] * (a - t0), x.o[1] + x.d[1] * (a - t0)], b: [x.o[0] + x.d[0] * (b - t0), x.o[1] + x.d[1] * (b - t0)] }); } });
    });
    return out;
  };
  const sig = (e) => (e.k === 'circle' ? `c${R4(e.c[0])},${R4(e.c[1])},${R4(e.r)}` : e.k === 'arc' ? `a${R4(e.c[0])},${R4(e.c[1])},${R4(e.r)},${R4(e.a0)},${R4(e.a1)}` : `p${R4(e.pts[0][0])},${R4(e.pts[0][1])},${R4(e.pts[24][0])},${R4(e.pts[24][1])},${R4(e.pts[48][0])},${R4(e.pts[48][1])}`);
  const uniq = (list, drop) => { const seen = new Set(drop || []); return list.filter((e) => { const k = sig(e); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const visCurves = uniq(vis.rest);
  return { visible: [...lines(vis), ...visCurves], hidden: [...lines(hid, vis), ...uniq(hid.rest, visCurves.map(sig))] };
}

// 面どうしの境目の線のうち、図面に描かない線を集める: (1) 円筒などの継ぎ目 (seam: 1 つの面の両側になる辺) と
// (2) なめらかにつながる面の境目 (接線の辺。 スロットの端の円筒と平らな壁の境目など)。
// ただし、その位置の面が視線と直角 (= 輪郭線になる) ときは、その線は輪郭として必要なので除かない。
// 戻り値: 視線方向 (dir) ごとの、線 (3 次元の折れ線) の一覧
function interiorEdges(shapes, dirs) {
  const buckets = new Map();
  shapes.forEach((sh) => sh.faces.forEach((f) => f.edges.forEach((e) => {
    const h = e.hashCode; if (!buckets.has(h)) buckets.set(h, []);
    const b = buckets.get(h); let rec = b.find((r) => r.edge.isSame(e));
    if (!rec) { rec = { edge: e, faces: [] }; b.push(rec); }
    rec.faces.push(f);
  })));
  const out = {};
  Object.keys(dirs).forEach((k) => { out[k] = []; });
  buckets.forEach((b) => b.forEach(({ edge, faces }) => {
    if (faces.length > 2) return;
    const m = edge.pointAt(0.5), unit = (v) => { const L = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / L, y: v.y / L, z: v.z / L }; };
    const n1 = unit(faces[0].normalAt([m.x, m.y, m.z]));
    let smooth = faces.length === 1 || faces[0].isSame(faces[1]); // 同じ面が両側にある = 継ぎ目
    if (!smooth) { const n2 = unit(faces[1].normalAt([m.x, m.y, m.z])); smooth = Math.abs(n1.x * n2.x + n1.y * n2.y + n1.z * n2.z) > 0.9995; }
    if (globalThis.__dbgEdges) (globalThis.__dbgEdges.push({ n: faces.length, smooth, m: [m.x, m.y, m.z].map((x) => +x.toFixed(2)), n1: [n1.x, n1.y, n1.z].map((x) => +x.toFixed(2)), t: faces.map((f) => f.geomType) }));
    if (!smooth) return;
    const pts = Array.from({ length: 129 }, (_, i) => { const v = edge.pointAt(i / 128); return [v.x, v.y, v.z]; });
    // 線に沿って面の向きが変わる (円の境目など) ので、いくつかの点で調べ、どこか 1 点でも視線と直角でなければ、線は輪郭ではない
    const ns = [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => { const q = edge.pointAt(t); return unit(faces[0].normalAt([q.x, q.y, q.z])); });
    Object.entries(dirs).forEach(([k, d]) => { if (ns.some((n) => Math.abs(n.x * d[0] + n.y * d[1] + n.z * d[2]) > 0.05)) out[k].push(pts); });
  }));
  return out;
}
// 投影した線のうち、interiorEdges と重なる線 (輪郭線として出たものは除く) を取り除く。 proj: 3 次元の点 → 図面の座標
function dropInterior(raw, polys) {
  const near = (p, q0, q1) => { const dx = q1[0] - q0[0], dy = q1[1] - q0[1], L2 = dx * dx + dy * dy; let t = L2 ? ((p[0] - q0[0]) * dx + (p[1] - q0[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - q0[0] - dx * t, p[1] - q0[1] - dy * t) < 0.01; };
  const onPoly = (pl, p) => pl.some((q, i) => i && near(p, pl[i - 1], q));
  const onArc = (e, t) => { // 円・円弧の上の点 (t: 0〜1)
    let a1 = e.k === 'circle' ? 360 : e.a1, a0 = e.k === 'circle' ? 0 : e.a0; while (a1 <= a0) a1 += 360;
    const ang = (a0 + (a1 - a0) * t) * Math.PI / 180; return [e.c[0] + e.r * Math.cos(ang), e.c[1] + e.r * Math.sin(ang)];
  };
  const samples = (e) => (e.k === 'line' ? [0, 0.25, 0.5, 0.75, 1].map((t) => [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t]) : e.k === 'poly' ? [0, 12, 24, 36, 48].map((i) => e.pts[i]) : [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => onArc(e, t)));
  const keep = (e) => { if (e.s === 'O') return true; const sm = samples(e); return !sm || !polys.some((pl) => sm.every((p) => onPoly(pl, p))); }; // 全部の点が、1 本の線の上にあるときだけ除く
  return { visible: raw.visible.filter(keep), hidden: raw.hidden.filter(keep), __filtered: true };
}

// ---- 操作 (ops) ----------------------------------------------------------------
const ops = {
  // 干渉: 部品どうしの共通部分の体積。 同じ部品 (inst が同じ) の立体どうしは調べない。
  // 面で接するだけ (体積 0) は干渉ではない。 戻り値の i, j は model の番号、 dz は共通部分の高さ
  async interfere({ model, byPart = false }) {
    let shapes = model.map(makeSolid), items = model;
    // 部品ごとの情報 (離れた立体があるかの確認に使う)。 融合できなくても干渉の確認は続ける
    let parts = null, fusedParts = null;
    try {
      fusedParts = fuseParts(model, shapes);
      parts = fusedParts.map((p) => ({ name: p.name, solids: p.solids }));
    } catch (e) { parts = null; }
    if (byPart && fusedParts) { // 部品ごと (融合した形) の干渉。 確認用
      shapes = fusedParts.map((p) => p.shape);
      items = fusedParts.map((p) => ({ name: p.name, inst: p.name }));
    }
    const bb = shapes.map((s) => s.boundingBox.bounds);
    const hits = [];
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        if (items[i].inst !== undefined && items[i].inst === items[j].inst) continue;
        const [a, b] = [bb[i], bb[j]];
        if ([0, 1, 2].some((k) => Math.min(a[1][k], b[1][k]) - Math.max(a[0][k], b[0][k]) <= 1e-7)) continue; // 外形が重ならない
        let volume = 0, dz = 0;
        try {
          const c = shapes[i].intersect(shapes[j]);
          volume = R.measureVolume(c);
          if (volume > 1e-3) { const cb = c.boundingBox.bounds; dz = cb[1][2] - cb[0][2]; }
        } catch (e) { volume = 0; } // 共通部分が空のときなど
        if (volume > 1e-3) hits.push({ i, j, volume, dz, a: items[i].name, b: items[j].name });
      }
    }
    return { hits, parts };
  },
  // 断面: 面 (plane: 'y' → y=at、'x' → x=at) で部品ごと (融合した形) に切った断面の輪郭。
  // 座標は図面の向き (y 面: 横 x・縦 z / x 面: 横 y・縦 z)。 戻り値: 切れた部品ごとの { key, name, faces: [{ outer, holes, area }], area }
  async section({ model, plane, at }) {
    const shapes = model.map(makeSolid);
    const fused = fuseParts(model, shapes);
    const B = 100000;
    const pt = (u, v) => (plane === 'y' ? [u, at, v] : [at, u, v]);
    const makeCutter = () => R.makePolygon([pt(-B, -B), pt(B, -B), pt(B, B), pt(-B, B)]); // 演算で使い切られるので、部品ごとに作る
    const uv = (v) => (plane === 'y' ? [v.x, v.z] : [v.y, v.z]);
    const loopOf = (wire) => { // 辺を端点でつないで、1 周の点列にする (曲線は 48 分割)
      const segs = wire.edges.map((e) => {
        const n = e.geomType === 'LINE' ? 1 : 48;
        return Array.from({ length: n + 1 }, (_, k) => uv(e.pointAt(k / n)));
      });
      const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
      const loop = segs.shift().slice();
      while (segs.length) {
        const end = loop[loop.length - 1];
        let k = segs.findIndex((q) => near(q[0], end)), rev = false;
        if (k < 0) { k = segs.findIndex((q) => near(q[q.length - 1], end)); rev = true; }
        if (k < 0) throw new Error('断面の輪郭がつながりません');
        const q = segs.splice(k, 1)[0];
        loop.push(...(rev ? q.slice(0, -1).reverse() : q.slice(1)));
      }
      if (near(loop[0], loop[loop.length - 1])) loop.pop();
      return loop;
    };
    const groups = [];
    for (const p of fused) {
      let c;
      try { c = p.shape.intersect(makeCutter()); } catch (e) { continue; } // 切れないとき
      const faces = c.faces;
      if (!faces.length) continue;
      // outerWire()・innerWires() は面を使い切るので、複製して呼ぶ
      const out = faces.map((f) => ({ area: R.measureArea(f), holes: f.clone().innerWires().map(loopOf), outer: loopOf(f.clone().outerWire()) }));
      groups.push({ key: p.key, name: p.name, faces: out, area: out.reduce((t, f) => t + f.area, 0) });
    }
    return { groups };
  },
  // 三面図 (隠れ線処理): 全部品 (融合した形) をまとめて、正面 (-y 側から) / 上面 (+z 側から) / 右側面 (+x 側から) の
  // 見える線と隠れ線を求める。 座標は図面の向き (正面: 横 x・縦 z / 上面: 横 x・縦 y / 右側面: 横 y・縦 z)。
  // 各線: { k: 'line'|'circle'|'arc'|'poly', ... }。 接線の線 (面取りでない丸みの境目) は含めない。
  async views({ model }) {
    const shapes = model.map(makeSolid);
    const fused = fuseParts(model, shapes);
    const cams = { front: [[0, -1, 0], [1, 0, 0]], top: [[0, 0, 1], [1, 0, 0]], right: [[1, 0, 0], [0, 1, 0]] };
    const out = {};
    const to2 = { front: (v) => [v[0], v[2]], top: (v) => [v[0], v[1]], right: (v) => [v[1], v[2]] };
    if (model.dbg) globalThis.__dbgEdges = [];
    const di = interiorEdges(fused.map((p) => p.shape), Object.fromEntries(Object.entries(cams).map(([k, [d]]) => [k, d])));
    const drops = Object.fromEntries(Object.entries(di).map(([k, list]) => [k, list.map((pl) => pl.map(to2[k]))]));
    for (const [name, [dir, xAxis]] of Object.entries(cams)) {
      const camera = new R.ProjectionCamera([0, 0, 0], dir, xAxis);
      // HLR は渡した形を使い切らないが、念のため部品ごとに複製してまとめる
      const compound = R.compoundShapes(fused.map((p) => p.shape.clone()));
      const oc = R.getOC(), res = new oc.HLRBRep_Algo();
      res.Add(compound.wrapped, 0);
      const proj = new oc.HLRAlgo_Projector(camera.wrapped);
      res.Projector(proj); res.Update(); res.Hide();
      const h = new oc.HLRBRep_HLRToShape(res);
      const edgesOf = (sh) => (sh.IsNull() ? [] : R.cast(sh).edges);
      const lists = { visible: [...edgesOf(h.VCompound()).map((e) => ((e.__s = 'V'), e)), ...edgesOf(h.Rg1LineVCompound()).map((e) => ((e.__s = 'R'), e)), ...edgesOf(h.OutLineVCompound()).map((e) => ((e.__s = 'O'), e))], hidden: [...edgesOf(h.HCompound()).map((e) => ((e.__s = 'V'), e)), ...edgesOf(h.Rg1LineHCompound()).map((e) => ((e.__s = 'R'), e)), ...edgesOf(h.OutLineHCompound()).map((e) => ((e.__s = 'O'), e))] };
      const raw = {};
      for (const [cls, edges] of Object.entries(lists)) {
        edges.forEach((e) => oc.BRepLib.BuildCurves3d(e.wrapped));
        raw[cls] = edges.map((e) => { const d = edgeData(e); if (d) d.s = e.__s; return d; }).filter(Boolean);
      }
      out[name] = normalizeView(raw.__filtered ? raw : dropInterior(raw, drops[name]));
    }
    if (model.dbg) { out.__drops = drops; out.__edges = globalThis.__dbgEdges; }
    return out;
  },
  // 立体の記述から、部品ごとに融合した STEP / STL と、部品ごとの体積・表面積・面の数・有効性を返す。
  // format: STEP の形式 (AP242 | AP214)。 融合の前の体積 (volumeBefore) も返す
  async buildModel({ model, format = 'AP242', test }) {
    const shapes = model.map(makeSolid);
    const before = shapes.map((s) => R.measureVolume(s));
    const fused = fuseParts(model, shapes, test);
    const parts = fused.map((p) => ({
      name: p.name, members: p.members, solids: p.solids,
      volumeBefore: p.idx.reduce((t, i) => t + before[i], 0), volume: R.measureVolume(p.shape), area: R.measureArea(p.shape),
      faces: p.shape.faces.length, valid: isValid(p.shape),
    }));
    const step = stepAscii(await exportStepAs(fused, format));
    const stl = await R.compoundShapes(fused.map((x) => x.shape)).blobSTL({ binary: false, tolerance: 0.01, angularTolerance: 0.1 }).text();
    return { step, stl, parts };
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
