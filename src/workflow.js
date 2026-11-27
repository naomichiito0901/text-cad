/* =====================================================================
 * 機械部品ワークフロー (工程1〜6)
 *   1 要件・案件情報  2 モデリング  3 干渉チェック
 *   4 図面化(三面図・寸法・図枠)  5 検図  6 納品・改訂
 * ===================================================================== */
const MATERIALS = ['SS400', 'S45C', 'S50C', 'SUS303', 'SUS304', 'SUS316', 'A5052', 'A6061', 'A7075', 'C1100', 'C3604', 'FC200', 'FCD450', 'SPCC', 'SECC', 'POM', 'ABS', 'MC', 'PEEK', 'PTFE'];
const STD_SCALES = [5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] };
const eps = 1e-6;

function sstr(v) {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}
const nf = (v) => String(Math.round(v * 1000) / 1000);
const scaleText = (s) => (s >= 1 ? `${nf(s)}:1` : `1:${nf(1 / s)}`);
const isStdScale = (s) => STD_SCALES.some((x) => Math.abs(x - s) < 1e-9);
function textW(str, h) {
  return [...String(str)].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 1 : 0.58), 0) * h;
}

/* ---------- 案件情報 ---------- */
function parseProject(spec) {
  const p = spec.project === undefined || spec.project === null ? {} : spec.project;
  if (!isObj(p)) fail('project: は「キー: 値」の形式で書いてください');
  const paper = sstr(p.paper) || 'A3';
  if (!PAPERS[paper]) fail(`project の paper は ${Object.keys(PAPERS).join(' / ')} のいずれかです`);
  let scale = 'auto';
  const sv = sstr(p.scale) || 'auto';
  if (sv.toLowerCase() !== 'auto') {
    const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(sv);
    if (!m || +m[1] <= 0 || +m[2] <= 0) fail('project の scale は auto または 1:2 のような形式で書いてください');
    scale = +m[1] / +m[2];
  }
  const notes = p.notes === undefined || p.notes === null ? [] : p.notes;
  if (!Array.isArray(notes)) fail('project の notes は「- 注記」の一覧で書いてください');
  // STEP の形式 (機械部品の 3D モデルの出力)。 省略時は AP242 (標準)。 AP214 は旧来の CAD との互換用
  const sf = (sstr(p.step_format) || 'AP242').toUpperCase().replace(/[\s_-]+/g, '');
  if (!['AP242', 'AP214'].includes(sf)) fail('project の step_format は AP242 または AP214 のどちらかです (省略すると AP242)');
  const dimensions = sstr(spec.dimensions) || 'auto';
  if (!['auto', 'none'].includes(dimensions)) fail('dimensions は auto か none です');
  return {
    title: sstr(p.title), drawing_no: sstr(p.drawing_no), material: sstr(p.material),
    designer: sstr(p.designer), drafter: sstr(p.drafter), date: sstr(p.date), due: sstr(p.due),
    standard: sstr(p.standard), general_tolerance: sstr(p.general_tolerance), finish: sstr(p.finish),
    rev: sstr(p.rev), step_format: sf, paper, scale, notes: notes.map(sstr).filter(Boolean), dimensions,
  };
}
const PROJECT_FIELDS = [
  ['title', '図名'], ['drawing_no', '図番'], ['material', '材質'], ['designer', '設計者'],
  ['drafter', '作図者'], ['date', '作成日'], ['due', '納期'], ['standard', '図面規格'],
  ['general_tolerance', '普通公差'], ['finish', '表面粗さ(一般)'], ['rev', '版'], ['step_format', 'STEP の形式'],
];

/* ---------- 立体の整理 (ワールド座標) ---------- */
function solidsOf(m) {
  const S = [];
  m.boxes.forEach((b) => S.push({
    kind: 'box', name: b.name, x0: b.at[0], y0: b.at[1], z0: b.at[2],
    x1: b.at[0] + b.size[0], y1: b.at[1] + b.size[1], z1: b.at[2] + b.size[2],
    holes: b.holes.map((h) => ({ ...h, x: b.at[0] + h.at[0], y: b.at[1] + h.at[1] })),
    slots: b.slots.map((sl) => ({ ...sl, cx: b.at[0] + sl.cx, cy: b.at[1] + sl.cy })),
    tol: b.tol, finish: b.finish, size: b.size, inst: b.inst, cr: b.cr || 0, ct: b.ct || 0, cb: b.cb || 0,
  }));
  m.cyls.forEach((c) => S.push({
    kind: 'cyl', name: c.name, cx: c.at[0], cy: c.at[1], r: c.d / 2, d: c.d, h: c.h,
    x0: c.at[0] - c.d / 2, x1: c.at[0] + c.d / 2, y0: c.at[1] - c.d / 2, y1: c.at[1] + c.d / 2,
    z0: c.at[2], z1: c.at[2] + c.h, holes: [], slots: [], tol: c.tol, finish: c.finish, inst: c.inst, cr: 0, ct: c.ct || 0, cb: c.cb || 0, ft: c.ft || 0, fb: c.fb || 0,
  }));
  return S;
}
/* ---------- 工程3: 干渉チェック ---------- */
// 部品どうしの干渉 (共通部分の体積) は、計算エンジンで求める (src/kernel-model.js / src/kernel-worker.js)
// 他の部品と接していない部品 (外形が接していない)。 組立で、どの部品とも外形が触れていないものを返す
function floatingParts(solids) {
  const floating = [];
  const group = (o) => (o.inst !== undefined ? o.inst : o.name);
  if (new Set(solids.map(group)).size > 1) {
    const done = new Set();
    solids.forEach((a) => {
      const g = group(a);
      if (done.has(g)) return;
      const touch = solids.some((x) => group(x) === g && solids.some((b) => group(b) !== g
        && Math.min(x.z1, b.z1) - Math.max(x.z0, b.z0) >= -eps
        && Math.min(x.x1, b.x1) - Math.max(x.x0, b.x0) >= -eps
        && Math.min(x.y1, b.y1) - Math.max(x.y0, b.y0) >= -eps));
      if (!touch) floating.push(g);
      done.add(g);
    });
  }
  return floating;
}

/* ---------- 図枠の共通部品 (機械・建築で共用) ---------- */
function roughSym(prims, x, y, text) {
  const LN = (a, b) => prims.push(line(a, b, 'DIM'));
  LN([x - 1.8, y + 2.6], [x, y]); LN([x, y], [x + 3.6, y + 7.2]);
  const w = textW(text, 2.8) + 2;
  LN([x + 3.6, y + 7.2], [x + 3.6 + w, y + 7.2]);
  prims.push({ t: 'text', p: [x + 4.4, y + 7.9], h: 2.8, s: String(text), layer: 'DIM', anchor: 'start', rot: 0 });
}
function sheetDecor(prims, o) {
  const { proj, revRows, scaleStr, asm, labels } = o;
  const [SW, SH] = PAPERS[proj.paper];
  const fl = 20, fr = SW - 10, fb = 10, ft = SH - 10, TBW = 150, tx = fr - TBW, tb = fb;
  const T = (s, x, y, h, op = {}) => prims.push({ t: 'text', p: [x, y], h, s: String(s), layer: op.layer || 'TEXT', anchor: op.anchor || 'middle', rot: op.rot || 0 });
  const RECT = (x0, y0, x1, y1, layer) => prims.push(...rectLines(x0, y0, x1, y1, layer));
  const fitT = (s, x, y, w, h, op = {}) => {
    const tw = textW(s, h);
    T(s, x, y, tw > w ? Math.max(1.4, h * w / tw) : h, op);
  };
  if (proj.finish) {
    const t = `${proj.finish}`;
    T('その他', fl + 6, ft - 8, 3.2, { anchor: 'start' });
    T('(', fl + 20, ft - 8.4, 6, { anchor: 'start' });
    roughSym(prims, fl + 25, ft - 11, t);
    T(')', fl + 28 + textW(t, 2.8) + 3.5, ft - 8.4, 6, { anchor: 'start' });
  }
  const cell = (x, y, w, h, label, value, vh = 3.6) => {
    RECT(x, y, x + w, y + h, 'TBLOCK');
    T(label, x + 1, y + h - 3, 2.2, { anchor: 'start', layer: 'TEXT' });
    fitT(value || '', x + 1, y + 2, w - 2, vh, { anchor: 'start', layer: 'TEXT' });
  };
  cell(tx, tb + 30, 100, 10, asm ? '図名 (組立図)' : '図名', proj.title, 5.5);
  cell(tx + 100, tb + 30, 50, 10, '図番', proj.drawing_no, 4.5);
  cell(tx, tb + 20, 50, 10, labels.material, asm ? '部品表参照' : proj.material);
  cell(tx + 50, tb + 20, 30, 10, '尺度', scaleStr);
  cell(tx + 80, tb + 20, 30, 10, labels.kind[0], labels.kind[1]);
  cell(tx + 110, tb + 20, 40, 10, '用紙/単位', `${proj.paper} / mm`);
  cell(tx, tb + 10, 37.5, 10, '設計', proj.designer);
  cell(tx + 37.5, tb + 10, 37.5, 10, '作図', proj.drafter);
  cell(tx + 75, tb + 10, 37.5, 10, '作成日', proj.date);
  cell(tx + 112.5, tb + 10, 37.5, 10, '納期', proj.due);
  cell(tx, tb, 55, 10, '図面規格', proj.standard);
  cell(tx + 55, tb, 65, 10, labels.tol || '普通公差', labels.tolValue ?? proj.general_tolerance);
  cell(tx + 120, tb, 30, 10, '版', proj.rev);

  const noteLines = [];
  if (proj.general_tolerance && !labels.noTolNote) noteLines.push(`普通公差: ${proj.general_tolerance}`);
  proj.notes.forEach((n) => noteLines.push(n));
  if (noteLines.length) {
    T('注記', fl + 4, fb + 34, 3.4, { anchor: 'start' });
    noteLines.slice(0, 6).forEach((n, i) => fitT(`${i + 1}. ${n}`, fl + 4, fb + 28 - i * 5, tx - fl - 8, 3.2, { anchor: 'start' }));
  }

  const nRev = Math.min(revRows.length, 4);
  if (nRev) {
    const rows = revRows.slice(-4), x0 = fr - 110, h = 6, yTop = ft - 2;
    const col = [14, 26, 70], heads = ['版', '日付', '改訂内容'];
    let cx = x0;
    heads.forEach((hd, i) => { RECT(cx, yTop - h, cx + col[i], yTop, 'TBLOCK'); T(hd, cx + 1, yTop - 4.2, 2.8, { anchor: 'start' }); cx += col[i]; });
    rows.forEach((r, k) => {
      const yy = yTop - h * (k + 1);
      let cx2 = x0;
      [r.rev, r.date, r.note].forEach((v, i) => { RECT(cx2, yy - h, cx2 + col[i], yy, 'TBLOCK'); fitT(v || '', cx2 + 1, yy - 4.2, col[i] - 2, 3, { anchor: 'start' }); cx2 += col[i]; });
    });
  }
}

/* ---------- 工程4: 三面図・寸法・図枠 ---------- */
function buildDrawing(S, proj, revRows, opts = {}) {
  const asm = !!opts.bom;
  const [SW, SH] = PAPERS[proj.paper];
  const fl = 20, fr = SW - 10, fb = 10, ft = SH - 10;
  const TBH = 40, TBW = 150, tx = fr - TBW;
  const bomRows = asm ? opts.bom : [];
  const BOMH = asm ? 7 * (bomRows.length + 1) : 0;
  const prims = [], need = new Set(), have = new Set();
  const T = (s, x, y, h, o = {}) => prims.push({ t: 'text', p: [x, y], h, s: String(s), layer: o.layer || 'TEXT', anchor: o.anchor || 'middle', rot: o.rot || 0 });
  const LN = (a, b, layer) => prims.push(line(a, b, layer));
  const RECT = (x0, y0, x1, y1, layer) => prims.push(...rectLines(x0, y0, x1, y1, layer));
  const fitT = (s, x, y, w, h, o = {}) => {
    const tw = textW(s, h);
    T(s, x, y, tw > w ? Math.max(1.4, h * w / tw) : h, o);
  };

  const xmin = Math.min(...S.map((s) => s.x0)), xmax = Math.max(...S.map((s) => s.x1));
  const ymin = Math.min(...S.map((s) => s.y0)), ymax = Math.max(...S.map((s) => s.y1));
  const zmin = Math.min(...S.map((s) => s.z0)), zmax = Math.max(...S.map((s) => s.z1));
  const W = xmax - xmin, D = ymax - ymin, H = zmax - zmin;
  const boxes = S.filter((s) => s.kind === 'box'), cyls = S.filter((s) => s.kind === 'cyl');
  const auto = proj.dimensions === 'auto';

  /* 寸法計画 (モデル単位, bbox 原点基準) */
  const uniq = (arr) => {
    const map = new Map();
    arr.forEach((r) => {
      const k = `${r.a.toFixed(4)}_${r.b.toFixed(4)}`;
      if (!map.has(k)) map.set(k, { ...r, keys: [...r.keys] }); else map.get(k).keys.push(...r.keys);
    });
    return [...map.values()].sort((p, q) => (p.b - p.a) - (q.b - q.a));
  };
  const withTol = (v, tol) => nf(v) + (tol ? ` ${tol}` : '');
  const hasRange = (arr, a, b) => arr.some((r) => Math.abs(r.a - a) < eps && Math.abs(r.b - b) < eps);
  let xr, yr, zr, cr, px = [], py = [];
  const centers = [];
  if (asm) {
    // 組立図は全体寸法のみ (各部品の寸法は部品図に記入)
    ['x', 'y', 'z'].forEach((a) => need.add(`overall:${a}`));
    xr = [{ a: 0, b: W, text: nf(W), keys: ['overall:x'] }];
    yr = [{ a: 0, b: D, text: nf(D), keys: ['overall:y'] }];
    zr = [{ a: 0, b: H, text: nf(H), keys: ['overall:z'] }];
    cr = [];
  } else {
    boxes.forEach((b) => ['x', 'y', 'z'].forEach((a) => need.add(`${b.name}:${a}`)));
    cyls.forEach((c) => ['d', 'h', 'x', 'y'].forEach((a) => need.add(`${c.name}:${a}`)));
    boxes.forEach((b) => b.holes.forEach((h, i) => ['d', 'x', 'y'].forEach((a) => need.add(`${b.name}.hole${i + 1}:${a}`))));
    boxes.forEach((b) => b.slots.forEach((sl, i) => ['d', 'x', 'y'].forEach((a) => need.add(`${b.name}.slot${i + 1}:${a}`))));
    boxes.forEach((b) => { if (b.cr) need.add(`${b.name}:r`); if (b.ct) need.add(`${b.name}:ct`); if (b.cb) need.add(`${b.name}:cb`); });
    cyls.forEach((c) => { if (c.ct) need.add(`${c.name}:ct`); if (c.cb) need.add(`${c.name}:cb`); if (c.ft) need.add(`${c.name}:ft`); if (c.fb) need.add(`${c.name}:fb`); });
    xr = uniq(boxes.map((b) => ({ a: b.x0 - xmin, b: b.x1 - xmin, text: withTol(b.x1 - b.x0, b.tol), keys: [`${b.name}:x`] })));
    yr = uniq(boxes.map((b) => ({ a: b.y0 - ymin, b: b.y1 - ymin, text: withTol(b.y1 - b.y0, b.tol), keys: [`${b.name}:y`] })));
    zr = uniq(boxes.map((b) => ({ a: b.z0 - zmin, b: b.z1 - zmin, text: withTol(b.z1 - b.z0, b.tol), keys: [`${b.name}:z`] })));
    cr = uniq(cyls.map((c) => ({ a: c.z0 - zmin, b: c.z1 - zmin, text: withTol(c.h, c.tol), keys: [`${c.name}:h`] })));
    if (boxes.length && !hasRange(xr, 0, W)) xr.push({ a: 0, b: W, text: nf(W), keys: [] });
    if (boxes.length && !hasRange(yr, 0, D)) yr.push({ a: 0, b: D, text: nf(D), keys: [] });
    if (!hasRange(zr, 0, H) && !hasRange(cr, 0, H)) zr.push({ a: 0, b: H, text: nf(H), keys: [] });
    const byLen = (arr) => arr.sort((p, q) => (p.b - p.a) - (q.b - q.a));
    byLen(xr); byLen(yr); byLen(zr);
    boxes.forEach((b) => b.holes.forEach((h, i) => centers.push({ r: h.d / 2, x: h.x - xmin, y: h.y - ymin, kx: `${b.name}.hole${i + 1}:x`, ky: `${b.name}.hole${i + 1}:y` })));
    boxes.forEach((b) => b.slots.forEach((sl, i) => centers.push({ r: Math.max(sl.w, sl.len) / 2, x: sl.cx - xmin, y: sl.cy - ymin, kx: `${b.name}.slot${i + 1}:x`, ky: `${b.name}.slot${i + 1}:y` })));
    cyls.forEach((c) => centers.push({ r: c.r, x: c.cx - xmin, y: c.cy - ymin, kx: `${c.name}:x`, ky: `${c.name}:y` }));
    const posDims = (axis) => {
      const map = new Map();
      centers.forEach((c) => {
        const v = c[axis], k = v.toFixed(4);
        if (!map.has(k)) map.set(k, { v, keys: [], ref: -Infinity });
        const e = map.get(k);
        e.keys.push(axis === 'x' ? c.kx : c.ky);
        e.ref = Math.max(e.ref, (axis === 'x' ? c.y : c.x) + c.r);
      });
      return [...map.values()].sort((p, q) => p.v - q.v).filter((d) => d.v > eps);
    };
    px = posDims('x'); py = posDims('y');
    centers.forEach((c) => { if (c.x <= eps) have.add(c.kx); if (c.y <= eps) have.add(c.ky); });
  }

  /* 余白とレイアウト */
  const LV = 8, tH = 3.2;
  const mL = 12 + LV * Math.max(zr.length, yr.length), mB = 10 + LV * xr.length;
  const mT = px.length ? 10 + LV * px.length : 4;
  const gh = Math.max(26, 16 + LV * cr.length), gv = asm ? 44 : 26;
  const rightExtra = py.length ? 14 + LV * py.length : 0;
  const nRev = Math.min(revRows.length, 4);
  const topStrip = 14 + (nRev ? 6 * (nRev + 1) : 0);
  const rx0 = fl + 6 + mL, rx1 = fr - 6;
  const ry0 = fb + TBH + BOMH + 6 + mB, ry1 = ft - topStrip - mT;
  const needW = (sc) => Math.max((W + D) * sc + gh, W * sc + rightExtra);
  const needH = (sc) => (H + D) * sc + gv;
  const fits = (sc) => needW(sc) <= rx1 - rx0 && needH(sc) <= ry1 - ry0;
  let s, fitsSheet = true;
  if (proj.scale === 'auto') {
    s = STD_SCALES.find(fits);
    if (!s) { s = STD_SCALES[STD_SCALES.length - 1]; fitsSheet = false; }
  } else { s = proj.scale; fitsSheet = fits(s); }
  const fx = rx0 + Math.max(0, ((rx1 - rx0) - needW(s)) / 2);
  const fy = ry0 + Math.max(0, ((ry1 - ry0) - needH(s)) / 2);
  const ty = fy + H * s + gv, rx = fx + W * s + gh;
  const FX = (x) => fx + (x - xmin) * s, FY = (z) => fy + (z - zmin) * s;
  const TX = FX, TY = (y) => ty + (y - ymin) * s;
  const RX = (y) => rx + (y - ymin) * s;
  const RZ = FY;

  /* 用紙・枠 */
  prims.push({ t: 'poly', pts: [[0, 0], [SW, 0], [SW, SH], [0, SH]], layer: 'PAPER', view: true });
  RECT(0, 0, SW, SH, 'TBLOCK');
  RECT(fl, fb, fr, ft, 'FRAME');

  /* 投影図: 手前の部品に隠れる線は隠れ線(破線)にする */
  const VIEWS = {
    front: { U: (o) => [o.x0, o.x1], V: (o) => [o.z0, o.z1], near: (B, A) => B.y0 < A.y0 - eps, map: (u, v) => [FX(u), FY(v)], disc: false },
    top: { U: (o) => [o.x0, o.x1], V: (o) => [o.y0, o.y1], near: (B, A) => B.z1 > A.z1 + eps, map: (u, v) => [TX(u), TY(v)], disc: true },
    right: { U: (o) => [o.y0, o.y1], V: (o) => [o.z0, o.z1], near: (B, A) => B.x1 > A.x1 + eps, map: (u, v) => [RX(u), RZ(v)], disc: false },
  };
  const inside = (V, B, u, v) => {
    if (V.disc && B.kind === 'cyl') return Math.hypot(u - B.cx, v - B.cy) < B.r - eps;
    const [u0, u1] = V.U(B), [v0, v1] = V.V(B);
    return u > u0 + eps && u < u1 - eps && v > v0 + eps && v < v1 - eps;
  };
  const cross = (V, B, horiz, c, lo, hi) => {
    const out = [];
    if (V.disc && B.kind === 'cyl') {
      const d = horiz ? c - B.cy : c - B.cx;
      if (Math.abs(d) < B.r) { const h = Math.sqrt(B.r * B.r - d * d), m = horiz ? B.cx : B.cy; out.push(m - h, m + h); }
    } else {
      const [u0, u1] = V.U(B), [v0, v1] = V.V(B);
      if (horiz) { if (c > v0 + eps && c < v1 - eps) out.push(u0, u1); }
      else if (c > u0 + eps && c < u1 - eps) out.push(v0, v1);
    }
    return out.filter((x) => x > lo + eps && x < hi - eps);
  };
  const seen = new Set();
  const LNu = (pa, pb, layer) => {
    const key = [layer, ...[pa, pb].map((t) => t.map((x) => x.toFixed(3)).join(',')).sort()].join('|');
    if (!seen.has(key)) { seen.add(key); LN(pa, pb, layer); }
  };
  const edge = (V, A, u1, v1, u2, v2) => {
    const horiz = Math.abs(v1 - v2) < eps;
    const lo = horiz ? Math.min(u1, u2) : Math.min(v1, v2), hi = horiz ? Math.max(u1, u2) : Math.max(v1, v2), c = horiz ? v1 : u1;
    const occ = S.filter((B) => B !== A && V.near(B, A));
    const bp = [lo, hi];
    occ.forEach((B) => bp.push(...cross(V, B, horiz, c, lo, hi)));
    bp.sort((p, q) => p - q);
    for (let i = 0; i < bp.length - 1; i++) {
      const a = bp[i], b = bp[i + 1];
      if (b - a < eps) continue;
      const mid = (a + b) / 2, hid = occ.some((B) => inside(V, B, horiz ? mid : c, horiz ? c : mid));
      LNu(V.map(...(horiz ? [a, c] : [c, a])), V.map(...(horiz ? [b, c] : [c, b])), hid ? 'HIDDEN' : 'OUTLINE');
    }
  };
  const rectEdges = (V, A) => {
    const [u0, u1] = V.U(A), [v0, v1] = V.V(A);
    edge(V, A, u0, v0, u1, v0); edge(V, A, u1, v0, u1, v1); edge(V, A, u1, v1, u0, v1); edge(V, A, u0, v1, u0, v0);
  };
  const circleTop = (A, cx, cy, r) => {
    const V = VIEWS.top, occ = S.filter((B) => B !== A && V.near(B, A));
    const pts = [[cx + r, cy], [cx - r, cy], [cx, cy + r], [cx, cy - r]];
    const hid = occ.some((B) => pts.every(([u, v]) => inside(V, B, u, v)));
    prims.push({ t: 'circle', c: [TX(cx), TY(cy)], r: r * s, layer: hid ? 'HIDDEN' : 'OUTLINE' });
  };
  const cl = (x0, y0, x1, y1) => LN([x0, y0], [x1, y1], 'CENTER');
  const ext = 3;
  const dline = (V, u0, v0, u1, v1, layer) => LNu(V.map(u0, v0), V.map(u1, v1), layer || 'OUTLINE');
  // 正面・側面の外形。面取りがあれば斜めの辺と、面取りの境界線も描く
  const profile = (V, A, u0, u1, v0, v1, ct, cb, ft = 0, fb = 0) => {
    if (!ct && !cb && !ft && !fb) { rectEdges(V, A); return; }
    const tt = ct || ft, bb = cb || fb;
    edge(V, A, u0 + bb, v0, u1 - bb, v0); edge(V, A, u0 + tt, v1, u1 - tt, v1);
    edge(V, A, u0, v0 + bb, u0, v1 - tt); edge(V, A, u1, v0 + bb, u1, v1 - tt);
    const arc = (cu, cv, R, a0, a1) => { const c = V.map(cu, cv); prims.push({ t: 'arc', c, r: R * s, a0, a1, layer: 'OUTLINE' }); };
    if (ft) { arc(u1 - ft, v1 - ft, ft, 0, 90); arc(u0 + ft, v1 - ft, ft, 90, 180); }
    if (fb) { arc(u0 + fb, v0 + fb, fb, 180, 270); arc(u1 - fb, v0 + fb, fb, 270, 360); }
    if (cb) { dline(V, u0, v0 + cb, u0 + cb, v0); dline(V, u1 - cb, v0, u1, v0 + cb); edge(V, A, u0, v0 + cb, u1, v0 + cb); }
    if (ct) { dline(V, u0, v1 - ct, u0 + ct, v1); dline(V, u1 - ct, v1, u1, v1 - ct); edge(V, A, u0, v1 - ct, u1, v1 - ct); }
  };
  const insetRect = (o, i, layer) => {
    const V = VIEWS.top;
    [[o.x0 + i, o.y0 + i, o.x1 - i, o.y0 + i], [o.x1 - i, o.y0 + i, o.x1 - i, o.y1 - i], [o.x1 - i, o.y1 - i, o.x0 + i, o.y1 - i], [o.x0 + i, o.y1 - i, o.x0 + i, o.y0 + i]]
      .forEach(([a, b, c, d]) => dline(V, a, b, c, d, layer));
  };
  const hiddenHole = (V, uc, h, z1, z0) => {
    const { pts } = holeSteps(h, z1, z0);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      LNu(V.map(uc - a.r, a.z), V.map(uc - b.r, b.z), 'HIDDEN'); LNu(V.map(uc + a.r, a.z), V.map(uc + b.r, b.z), 'HIDDEN');
    }
    if (h.depth != null) { const l = pts[pts.length - 1]; LNu(V.map(uc - l.r, l.z), V.map(uc + l.r, l.z), 'HIDDEN'); }
  };
  S.forEach((o) => {
    if (o.kind === 'box') {
      profile(VIEWS.front, o, o.x0, o.x1, o.z0, o.z1, o.ct, o.cb);
      profile(VIEWS.right, o, o.y0, o.y1, o.z0, o.z1, o.ct, o.cb);
      if (o.cr) {
        const R = o.cr, V = VIEWS.top;
        edge(V, o, o.x0 + R, o.y0, o.x1 - R, o.y0); edge(V, o, o.x1, o.y0 + R, o.x1, o.y1 - R);
        edge(V, o, o.x1 - R, o.y1, o.x0 + R, o.y1); edge(V, o, o.x0, o.y1 - R, o.x0, o.y0 + R);
        [[o.x1 - R, o.y0 + R, -90, 0], [o.x1 - R, o.y1 - R, 0, 90], [o.x0 + R, o.y1 - R, 90, 180], [o.x0 + R, o.y0 + R, 180, 270]]
          .forEach(([cx, cy, a0, a1]) => prims.push({ t: 'arc', c: [TX(cx), TY(cy)], r: R * s, a0, a1, layer: 'OUTLINE' }));
      } else rectEdges(VIEWS.top, o);
      if (o.ct) insetRect(o, o.ct, 'OUTLINE');
      if (o.cb) insetRect(o, o.cb, 'HIDDEN');
      o.holes.forEach((h) => {
        const e = holeRim(h) * s + ext, H = o.z1 - o.z0;
        if (h.tilt) {
          const a = h.d / 2 / tiltC(h), rot = h.tdir[0] ? 0 : 90, sh = H * tiltT(h);
          prims.push(...ellipseLines(TX(h.x), TY(h.y), a * s, h.d / 2 * s, rot, 'OUTLINE').map((q) => q));
          prims.push(...ellipseLines(TX(h.x + h.tdir[0] * sh), TY(h.y + h.tdir[1] * sh), a * s, h.d / 2 * s, rot, 'HIDDEN'));
          // 正面・側面: 傾いた穴の隠れ線と中心線
          [[VIEWS.front, 0, h.x], [VIEWS.right, 1, h.y]].forEach(([V, ci, c0]) => {
            const half = h.tdir[ci] ? a : h.d / 2, t = h.tdir[ci] * tiltT(h), uc = (z) => c0 + t * (o.z1 - z);
            [-1, 1].forEach((sg) => LNu(V.map(uc(o.z1) + sg * half, o.z1), V.map(uc(o.z0) + sg * half, o.z0), 'HIDDEN'));
            const ee = ext / s;
            const p0 = V.map(uc(o.z1 + ee), o.z1 + ee), p1 = V.map(uc(o.z0 - ee), o.z0 - ee);
            cl(p0[0], p0[1], p1[0], p1[1]);
          });
          cl(TX(h.x) - e, TY(h.y), TX(h.x) + e, TY(h.y)); cl(TX(h.x), TY(h.y) - e, TX(h.x), TY(h.y) + e);
          return;
        }
        holeRadii(h).forEach((r) => circleTop(o, h.x, h.y, r));
        if (h.thread) prims.push({ t: 'arc', c: [TX(h.x), TY(h.y)], r: h.thread.D / 2 * s, a0: 0, a1: 270, layer: 'THREAD' });
        cl(TX(h.x) - e, TY(h.y), TX(h.x) + e, TY(h.y)); cl(TX(h.x), TY(h.y) - e, TX(h.x), TY(h.y) + e);
        hiddenHole(VIEWS.front, h.x, h, o.z1, o.z0);
        cl(FX(h.x), FY(o.z0) - ext, FX(h.x), FY(o.z1) + ext);
        hiddenHole(VIEWS.right, h.y, h, o.z1, o.z0);
        cl(RX(h.y), RZ(o.z0) - ext, RX(h.y), RZ(o.z1) + ext);
        if (h.thread) { // ねじの谷(呼び径)の隠れ線: ねじ深さまで
          const zt = h.thread.depth != null ? o.z1 - h.thread.depth : (h.depth != null ? o.z1 - h.depth : o.z0), rr = h.thread.D / 2;
          [[VIEWS.front, h.x], [VIEWS.right, h.y]].forEach(([V, uc]) => [-1, 1].forEach((sg) => LNu(V.map(uc + sg * rr, o.z1), V.map(uc + sg * rr, zt), 'HIDDEN')));
        }
      });
      o.slots.forEach((sl) => {
        slotOutline(sl, 'OUTLINE').forEach((q) => prims.push(xfPrim(q, (pt) => [TX(pt[0]), TY(pt[1])], s)));
        const [sa, sb] = slotSeg(sl), r = sl.w / 2, ee = ext / s;
        if (sl.dir === 'x') { cl(TX(sa[0] - r) - ext, TY(sl.cy), TX(sb[0] + r) + ext, TY(sl.cy)); cl(TX(sl.cx), TY(sl.cy - r) - ext, TX(sl.cx), TY(sl.cy + r) + ext); }
        else { cl(TX(sl.cx), TY(sa[1] - r) - ext, TX(sl.cx), TY(sb[1] + r) + ext); cl(TX(sl.cx - r) - ext, TY(sl.cy), TX(sl.cx + r) + ext, TY(sl.cy)); }
        const fu = sl.dir === 'x' ? sl.len / 2 : r, ru = sl.dir === 'x' ? r : sl.len / 2;
        [-1, 1].forEach((sg) => {
          LNu([FX(sl.cx + sg * fu), FY(o.z0)], [FX(sl.cx + sg * fu), FY(o.z1)], 'HIDDEN');
          LNu([RX(sl.cy + sg * ru), RZ(o.z0)], [RX(sl.cy + sg * ru), RZ(o.z1)], 'HIDDEN');
        });
        cl(FX(sl.cx), FY(o.z0) - ext, FX(sl.cx), FY(o.z1) + ext); cl(RX(sl.cy), RZ(o.z0) - ext, RX(sl.cy), RZ(o.z1) + ext);
        void ee;
      });
    } else {
      const e = o.r * s + ext;
      circleTop(o, o.cx, o.cy, o.r);
      if (o.ct) prims.push({ t: 'circle', c: [TX(o.cx), TY(o.cy)], r: (o.r - o.ct) * s, layer: 'OUTLINE' });
      if (o.cb) prims.push({ t: 'circle', c: [TX(o.cx), TY(o.cy)], r: (o.r - o.cb) * s, layer: 'HIDDEN' });
      cl(TX(o.cx) - e, TY(o.cy), TX(o.cx) + e, TY(o.cy)); cl(TX(o.cx), TY(o.cy) - e, TX(o.cx), TY(o.cy) + e);
      profile(VIEWS.front, o, o.x0, o.x1, o.z0, o.z1, o.ct, o.cb, o.ft, o.fb);
      profile(VIEWS.right, o, o.y0, o.y1, o.z0, o.z1, o.ct, o.cb, o.ft, o.fb);
      cl(FX(o.cx), FY(o.z0) - ext, FX(o.cx), FY(o.z1) + ext);
      cl(RX(o.cy), RZ(o.z0) - ext, RX(o.cy), RZ(o.z1) + ext);
    }
  });

  if (opts.cuts && opts.cuts.length) drawCutLines(prims, opts.cuts, TX, TY, xmin, xmax, ymin, ymax);

  /* 寸法記入 */
  const arrow = (tip, d) => {
    const n = [-d[1], d[0]];
    prims.push({ t: 'poly', layer: 'DIM', fill: true, pts: [tip, [tip[0] + d[0] * 3 + n[0] * 0.9, tip[1] + d[1] * 3 + n[1] * 0.9], [tip[0] + d[0] * 3 - n[0] * 0.9, tip[1] + d[1] * 3 - n[1] * 0.9]] });
  };
  const dimH = (xa, xb, yFa, yFb, yDim, text) => {
    const sg = yDim >= yFa ? 1 : -1;
    [[xa, yFa], [xb, yFb]].forEach(([x, yf]) => LN([x, yf + sg * 1.5], [x, yDim + sg * 2], 'DIM'));
    LN([xa, yDim], [xb, yDim], 'DIM'); arrow([xa, yDim], [1, 0]); arrow([xb, yDim], [-1, 0]);
    T(text, (xa + xb) / 2, yDim + 1.1, tH, { layer: 'DIM' });
  };
  const dimV = (ya, yb, xFa, xFb, xDim, text) => {
    const sg = xDim >= xFa ? 1 : -1;
    [[ya, xFa], [yb, xFb]].forEach(([y, xf]) => LN([xf + sg * 1.5, y], [xDim + sg * 2, y], 'DIM'));
    LN([xDim, ya], [xDim, yb], 'DIM'); arrow([xDim, ya], [0, 1]); arrow([xDim, yb], [0, -1]);
    T(text, xDim - 1.1, (ya + yb) / 2, tH, { layer: 'DIM', rot: 90 });
  };
  const mark = (keys) => keys.forEach((k) => have.add(k));
  if (auto) {
    xr.forEach((r, i) => { const y = FY(zmin); dimH(FX(xmin + r.a), FX(xmin + r.b), y, y, fy - 9 - LV * i, r.text); mark(r.keys); });
    zr.forEach((r, i) => { const x = FX(xmin); dimV(FY(zmin + r.a), FY(zmin + r.b), x, x, fx - 9 - LV * i, r.text); mark(r.keys); });
    cr.forEach((r, i) => { const x = FX(xmax); dimV(FY(zmin + r.a), FY(zmin + r.b), x, x, x + 9 + LV * i, r.text); mark(r.keys); });
    yr.forEach((r, i) => { const x = TX(xmin); dimV(TY(ymin + r.a), TY(ymin + r.b), x, x, fx - 9 - LV * i, r.text); mark(r.keys); });
    px.forEach((d, i) => { dimH(TX(xmin), TX(xmin + d.v), TY(ymax), TY(ymin + d.ref), TY(ymax) + 9 + LV * i, nf(d.v)); mark(d.keys); });
    py.forEach((d, i) => { dimV(TY(ymin), TY(ymin + d.v), TX(xmax), TX(xmin + d.ref), TX(xmax) + 9 + LV * i, nf(d.v)); mark(d.keys); });

    if (!asm) {
      const noteLeader = (p0, dir, text, left) => {
        const p1 = [p0[0] + dir[0], p0[1] + dir[1]], tw = textW(text, tH) + 2, sx = left ? -1 : 1, d = Math.hypot(dir[0], dir[1]);
        LN(p0, p1, 'DIM'); LN(p1, [p1[0] + tw * sx, p1[1]], 'DIM');
        arrow(p0, [dir[0] / d, dir[1] / d]);
        T(text, p1[0] + sx, p1[1] + 0.9, tH, { layer: 'DIM', anchor: left ? 'end' : 'start' });
      };
      // 引出し線(線と文字)が、穴・寸法補助線・他の引出し線と重ならない位置を探す
      const obs = [];
      const keyOf = (x, y) => `${x.toFixed(2)},${y.toFixed(2)}`;
      const circleBox = (cx, cy, r) => obs.push({ r: [cx - r, cy - r, cx + r, cy + r], own: keyOf(cx, cy) });
      boxes.forEach((b) => b.holes.forEach((h) => circleBox(TX(h.x), TY(h.y), holeRim(h) * s)));
      boxes.forEach((b) => b.slots.forEach((sl) => circleBox(TX(sl.cx), TY(sl.cy), Math.max(sl.w, sl.len) / 2 * s)));
      cyls.forEach((c) => circleBox(TX(c.cx), TY(c.cy), c.r * s));
      centers.forEach((c) => {
        const cx = TX(xmin + c.x), cy = TY(ymin + c.y), r = c.r * s;
        obs.push({ r: [cx - 0.6, cy + r, cx + 0.6, TY(ymax) + 9 + LV * Math.max(px.length, 1)] });   // 上へ伸びる寸法補助線
        obs.push({ r: [cx + r, cy - 0.6, TX(xmax) + 9 + LV * Math.max(py.length, 1), cy + 0.6] }); // 右へ伸びる寸法補助線
      });
      const hitCount = (r, own) => obs.reduce((n, o) => n + (o.own !== own && r[0] < o.r[2] && r[2] > o.r[0] && r[1] < o.r[3] && r[3] > o.r[1] ? 1 : 0), 0);
      const lineRects = (p, q) => Array.from({ length: 9 }, (_, i) => { const t = i / 8, x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t; return [x - 0.7, y - 0.7, x + 0.7, y + 0.7]; });
      const plate = [TX(xmin) + 1, TY(ymin) + 1, TX(xmax) - 1, TY(ymax) - 1];
      const inPlate = (r) => r[0] >= plate[0] && r[2] <= plate[2] && r[1] >= plate[1] && r[3] <= plate[3];
      const leader = (cx, cy, rp, text, rpFn) => {
        const side0 = cx > TX(xmin) + (W * s) / 2 ? -1 : 1, tw = textW(text, tH) * 1.12 + 2.5, own = keyOf(cx, cy);
        const tries = [];
        [-9, -18, -27, -36, -45, 9, 18, 27].forEach((dy) => [9, 16, 24, 32, 40].forEach((dx) => { tries.push([side0, dx, dy]); tries.push([-side0, dx, dy]); }));
        const place = ([sx, dx, dy]) => {
          const a = sx < 0 ? (dy < 0 ? -3 * Math.PI / 4 : 3 * Math.PI / 4) : (dy < 0 ? -Math.PI / 4 : Math.PI / 4);
          const rr = rpFn ? rpFn(a) : rp;
          const p0 = [cx + rr * Math.cos(a), cy + rr * Math.sin(a)], p1 = [p0[0] + dx * sx, p0[1] + dy];
          const rect = sx > 0 ? [p1[0], p1[1], p1[0] + tw, p1[1] + tH + 1.5] : [p1[0] - tw, p1[1], p1[0], p1[1] + tH + 1.5];
          const lines = lineRects(p0, p1);
          const score = hitCount(rect, own) * 6 + lines.reduce((n, r) => n + hitCount(r, own), 0) + (inPlate(rect) && inPlate([p1[0], p1[1], p1[0], p1[1]]) ? 0 : 40) + (Math.abs(dy) + dx) * 0.01;
          return { sx, p0, p1, dir: [dx * sx, dy], rect, lines, score };
        };
        const chosen = tries.map(place).reduce((best, t) => (t.score < best.score ? t : best));
        obs.push({ r: chosen.rect }, ...chosen.lines.map((r) => ({ r })));
        noteLeader(chosen.p0, chosen.dir, text, chosen.sx < 0);
      };
      boxes.forEach((b) => {
        const groups = new Map();
        b.holes.forEach((h, i) => {
          const text = holeText(h);
          if (!groups.has(text)) groups.set(text, { h, n: 0 });
          groups.get(text).n++;
          have.add(`${b.name}.hole${i + 1}:d`);
        });
        groups.forEach(({ h, n }, text) => leader(TX(h.x), TY(h.y), holeRim(h) * s, (n > 1 ? `${n}-` : '') + text));
        const sgroups = new Map();
        b.slots.forEach((sl, i) => {
          const text = slotText(sl);
          if (!sgroups.has(text)) sgroups.set(text, { sl, n: 0 });
          sgroups.get(text).n++;
          have.add(`${b.name}.slot${i + 1}:d`);
        });
        sgroups.forEach(({ sl, n }, text) => {
          const [sa, sb] = slotSeg(sl).map(([x, y]) => [TX(x), TY(y)]), cx = TX(sl.cx), cy = TY(sl.cy);
          // 長穴の輪郭(線分から幅/2 の距離)までの距離を、方向ごとに二分法で求める
          const edgeAt = (a) => { let lo = 0, hi = Math.max(sl.w, sl.len) * s; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (distSeg(cx + mid * Math.cos(a), cy + mid * Math.sin(a), sa, sb) <= sl.w / 2 * s) lo = mid; else hi = mid; } return lo; };
          leader(cx, cy, 0, (n > 1 ? `${n}-` : '') + text, edgeAt);
        });
        if (b.cr) { // 角R: 上面図の左下の角から引き出す
          const R = b.cr, a = 5 * Math.PI / 4;
          noteLeader([TX(b.x0 + R + R * Math.cos(a)), TY(b.y0 + R + R * Math.sin(a))], [-8, -10], `4-R${nf(R)}`, true);
          have.add(`${b.name}:r`);
        }
      });
      cyls.forEach((c) => {
        leader(TX(c.cx), TY(c.cy), c.r * s, `φ${nf(c.d)}${c.tol ? ' ' + c.tol : ''}`);
        have.add(`${c.name}:d`);
      });
      // 面取り: 右側面図の右上・右下の角から引き出す (右側は空いている)
      S.forEach((o) => {
        if (o.ct) { noteLeader([RX(o.y1 - o.ct / 2), RZ(o.z1 - o.ct / 2)], [8, 10], `C${nf(o.ct)}`, false); have.add(`${o.name}:ct`); }
        if (o.cb) { noteLeader([RX(o.y1 - o.cb / 2), RZ(o.z0 + o.cb / 2)], [8, -10], `C${nf(o.cb)}`, false); have.add(`${o.name}:cb`); }
        const k = Math.SQRT1_2; // 円弧の中央(45°)の点から引き出す
        if (o.ft) { noteLeader([FX(o.x0 + o.ft - o.ft * k), FY(o.z1 - o.ft + o.ft * k)], [-8, 10], `R${nf(o.ft)}`, true); have.add(`${o.name}:ft`); } // 上端のRは正面図(手前に見える側)から
        if (o.fb) { noteLeader([RX(o.y1 - o.fb + o.fb * k), RZ(o.z0 + o.fb - o.fb * k)], [8, -10], `R${nf(o.fb)}`, false); have.add(`${o.name}:fb`); }
      });
    }
  }

  /* 表面粗さ記号 */
  const rough = (x, y, text) => roughSym(prims, x, y, text);
  const rough_provided = [];
  if (!asm) {
    S.forEach((o) => {
      if (!o.finish) return;
      const legBusy = o.holes.map((h) => [h.x - 5 / s, h.x + 3 / s]);
      const above = S.filter((q) => q !== o && Math.abs(q.z0 - o.z1) < eps).map((q) => [q.x0 - 1 / s, q.x1 + 1 / s]);
      const symW = (4 + textW(o.finish, 2.8) + 2) / s;
      const cands = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9].map((f) => (o.kind === 'box' ? o.x0 + (o.x1 - o.x0) * f : o.cx));
      const cx = cands.find((c) => legBusy.every(([p, q]) => c < p || c > q) && above.every(([p, q]) => c + symW < p || c - 2 / s > q)) ?? cands[0];
      rough(FX(cx), FY(o.z1), o.finish);
      rough_provided.push(o.name);
    });
  }
  /* 組立図: 部品番号(吹き出し)と部品表 */
  if (asm) {
    const items = opts.balloons || [];
    const att = items.map((it) => {
      const sols = S.filter((o) => it.names.includes(o.name));
      const cands = [];
      sols.forEach((o) => { [0.5, 0.2, 0.8].forEach((f) => cands.push(o.x0 + (o.x1 - o.x0) * f)); });
      for (const u of cands) {
        const tops = sols.filter((q) => u > q.x0 && u < q.x1).map((q) => q.z1);
        if (!tops.length) continue;
        const topZ = Math.max(...tops);
        if (!S.some((q) => !it.names.includes(q.name) && u > q.x0 - eps && u < q.x1 + eps && q.z1 > topZ + eps)) return { n: it.n, u, z: topZ };
      }
      const o = sols[0];
      return { n: it.n, u: (o.x0 + o.x1) / 2, z: o.z1 };
    }).sort((a, b) => a.u - b.u);
    let prev = -Infinity;
    att.forEach((a) => {
      const bx = Math.max(FX(a.u), prev + 11), by = fy + H * s + 17;
      prev = bx;
      prims.push({ t: 'circle', c: [bx, by], r: 4.2, layer: 'DIM' });
      T(a.n, bx, by - 1.3, 3.6, { layer: 'DIM' });
      LN([bx, by - 4.2], [FX(a.u), FY(a.z)], 'DIM');
      prims.push({ t: 'circle', c: [FX(a.u), FY(a.z)], r: 0.7, layer: 'DIM', fill: true });
    });
    const cols = [15, 60, 45, 15, 15], heads = ['品番', '部品名', '材質', '数量', '備考'], by0 = fb + TBH;
    let cx = tx;
    heads.forEach((hd, i) => { RECT(cx, by0, cx + cols[i], by0 + 7, 'TBLOCK'); T(hd, cx + cols[i] / 2, by0 + 2, 3.2); cx += cols[i]; });
    bomRows.forEach((r, k) => {
      const y = by0 + 7 * (k + 1);
      let c2 = tx;
      [r.no, r.title, r.material, r.qty, r.note || ''].forEach((v, i) => {
        RECT(c2, y, c2 + cols[i], y + 7, 'TBLOCK');
        const left = i === 1 || i === 2;
        fitT(v, c2 + (left ? 1.5 : cols[i] / 2), y + 2, cols[i] - 3, 3.4, { anchor: left ? 'start' : 'middle' });
        c2 += cols[i];
      });
    });
  }

  sheetDecor(prims, { proj, revRows, scaleStr: scaleText(s), asm, labels: { material: '材質', kind: ['投影法', '第三角法'] } });

  if (!auto) T('※ 寸法は未記入です (dimensions: none)', fx, fy - 10, 3.6, { anchor: 'start' });
  return { prims, scale: s, fits: fitsSheet, need: [...need], have: [...have], paper: proj.paper, roughness: rough_provided, bbox: { W, D, H }, title: proj.title, drawing_no: proj.drawing_no };
}

/* ---------- 組立: 部品表・すきま ---------- */
function buildBOM(asmInfo) {
  return asmInfo.defs.map((d) => ({
    no: d.n, key: d.key, title: d.title, material: d.material, drawing_no: d.drawing_no,
    qty: asmInfo.insts.filter((i) => i.part === d.key).length, note: '',
  }));
}
function bomCSV(bom, project) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [['品番', '部品名', '図番', '材質', '数量'], ...bom.map((r) => [r.no, r.title, r.drawing_no || `${project.drawing_no}-${r.no}`, r.material, r.qty])].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
// 同軸の「軸(円柱) ⇔ 穴」の組み合わせとすきま (すきま = 穴径 − 軸径)
function findFits(solids) {
  const out = [];
  const cyls = solids.filter((s) => s.kind === 'cyl');
  solids.filter((s) => s.kind === 'box').forEach((b) => b.holes.forEach((h) => cyls.forEach((c) => {
    if (c.inst !== undefined && c.inst === b.inst) return;
    if (Math.hypot(c.cx - h.x, c.cy - h.y) > 1e-6) return;
    const lo = Math.max(c.z0, b.z0), hi = Math.min(c.z1, b.z1);
    if (hi - lo <= eps) return;
    // 軸がある高さでの穴の径 (座ぐり部・皿穴部・本穴で径が変わる)
    const r = holeRadiusAt(h, b.z1, b.z0, (lo + hi) / 2);
    if (r <= 0) return;
    out.push({ shaft: c.name, hole: b.name, dShaft: c.d, dHole: r * 2, clearance: r * 2 - c.d, fit: h.fit, tol: c.tol });
  })));
  return out;
}

/* ---------- 工程5: 自動検図 ---------- */
const requiredKeys = (kind) => (kind === 'asm' || kind === 'arch' ? ['title', 'drawing_no', 'designer', 'drafter', 'date'] : ['title', 'drawing_no', 'material', 'designer', 'drafter', 'date']);
function runChecks(ctx) {
  const { project: P, mechs, solids, interference, drawings, asmInfo } = ctx;
  const rules = [];
  const add = (id, name, sev, ok, detail) => rules.push({ id, name, sev, ok, detail: detail || '' });
  const labelOf = (k) => (PROJECT_FIELDS.find(([key]) => key === k) || [k, k])[1];

  const reqK = requiredKeys(asmInfo ? 'asm' : 'single');
  const missing = reqK.filter((k) => !P[k]).map(labelOf);
  add('E01', `案件情報の必須項目 (${reqK.map(labelOf).join('・')})`, 'error', !missing.length, missing.length ? `未記入: ${missing.join('、')}` : '');
  if (asmInfo) {
    const bad = asmInfo.defs.filter((d) => !d.material).map((d) => d.key);
    add('E05', '部品表: 全部品に材質が記入済み', 'error', !bad.length, `未記入: ${bad.join('、')}`);
  }
  const dimMiss = drawings.map((dw) => ({ label: dw.label, miss: dw.d.need.filter((k) => !dw.d.have.includes(k)) })).filter((x) => x.miss.length);
  add('E02', '寸法の記入漏れ (形状寸法・穴径・位置寸法)', 'error', !dimMiss.length,
    dimMiss.map((x) => `${x.label}: ${x.miss.length} 件 (${x.miss.slice(0, 4).join(', ')}${x.miss.length > 4 ? ' ...' : ''})`).join(' / '));
  add('E03', asmInfo ? '部品どうしの干渉 (組立)' : '部品どうしの干渉', 'error', interference.state === 'done' && !interference.hits.length,
    interference.state === 'pending' ? '計算エンジンで確認中です'
      : interference.state === 'unavailable' ? '計算エンジンが使えないため確認できません'
        : interference.hits.map((h) => `${h.a} × ${h.b} (${h.volume < 10 ? h.volume.toFixed(1) : Math.round(h.volume).toLocaleString('ja-JP')} mm³)`).join(' / '));
  const nofit = drawings.filter((dw) => !dw.d.fits);
  add('E04', '図面が用紙に収まっている', 'error', !nofit.length, `${nofit.map((dw) => dw.label).join('、')}: 尺度 ${nofit[0] ? scaleText(nofit[0].d.scale) : ''} では ${P.paper} に収まりません。用紙か尺度を変更してください`);
  const nonStd = drawings.filter((dw) => !isStdScale(dw.d.scale));
  add('W01', '尺度が規格尺度 (JIS Z 8314)', 'warn', !nonStd.length, nonStd.map((dw) => `${dw.label}: ${scaleText(dw.d.scale)}`).join(' / '));
  add('W02', '普通公差の指定', 'warn', !!P.general_tolerance, '例: general_tolerance: JIS B 0405 中級');
  add('W03', '表面粗さ(一般)の指定', 'warn', !!P.finish, '例: finish: Ra 6.3');
  add('W04', '図面規格の指定', 'warn', !!P.standard, '例: standard: JIS B 0001');
  const mats = asmInfo ? asmInfo.defs.map((d) => d.material).filter(Boolean) : [P.material].filter(Boolean);
  const unknownMat = mats.filter((m) => !MATERIALS.includes(m.toUpperCase()));
  add('W05', '材質が登録済みの材質名', 'warn', !unknownMat.length, `未登録: ${unknownMat.join('、')} (${MATERIALS.slice(0, 8).join(' / ')} ...)`);
  add('W06', '納期の指定と整合 (作成日以降)', 'warn', !!P.due && (!P.date || P.due >= P.date), !P.due ? '納期が未記入です' : '納期が作成日より前です');
  add('W07', asmInfo ? '他の部品と接していない部品がない (組立)' : '浮いている部品がない', 'warn', !interference.floating.length, `他の部品と接していない: ${interference.floating.join('、')}`);

  const edge = [], pitch = [], deep = [], thin = [], fitMiss = [], shallow = [], threadShort = [], threadDrill = [], steep = [], slotEdge = [];
  mechs.forEach((m) => m.boxes.forEach((b) => {
    if (Math.min(...b.size) < 1) thin.push(`${b.name} (${nf(Math.min(...b.size))})`);
    b.slots.forEach((sl, i) => {
      const hx = sl.dir === 'x' ? sl.len / 2 : sl.w / 2, hy = sl.dir === 'x' ? sl.w / 2 : sl.len / 2;
      const e = Math.min(sl.cx - hx, b.size[0] - sl.cx - hx, sl.cy - hy, b.size[1] - sl.cy - hy);
      if (e < sl.w) slotEdge.push(`${b.name}.slot${i + 1} 縁端 ${nf(e)} < 幅 ${nf(sl.w)}`);
    });
    b.holes.forEach((h, i) => {
      const nm = `${b.name}.hole${i + 1}`;
      const rim = holeRim(h);
      if (h.thread) {
        const th = h.thread, drillDepth = h.depth != null ? h.depth : b.size[2], td = th.depth != null ? th.depth : drillDepth;
        if (td < th.D) threadShort.push(`${nm} ${th.name} ねじ深さ ${nf(td)} < 呼び径 ${nf(th.D)}`);
        if (h.depth != null && drillDepth < td + th.D * 0.5) threadDrill.push(`${nm} 下穴 ${nf(drillDepth)} < ねじ深さ ${nf(td)} + ${nf(th.D * 0.5)}`);
      }
      if (h.tilt > 45) steep.push(`${nm} 傾斜 ${nf(h.tilt)}°`);
      const e = Math.min(h.at[0] - rim, b.size[0] - h.at[0] - rim, h.at[1] - rim, b.size[1] - h.at[1] - rim);
      if (e < h.d) edge.push(`${nm} 縁端 ${nf(e)} < φ${nf(h.d)}`);
      const dep = h.depth != null ? h.depth : b.size[2];
      if (dep / h.d > 5) deep.push(`${nm} 深さ/径 = ${nf(dep / h.d)}`);
      if (h.depth != null && b.size[2] - h.depth < 1) shallow.push(`${nm} 残り ${nf(b.size[2] - h.depth)}`);
      if (!h.fit && !h.tol && !h.thread) fitMiss.push(nm);
      b.holes.slice(i + 1).forEach((g, k) => {
        const web = Math.hypot(h.at[0] - g.at[0], h.at[1] - g.at[1]) - (rim + holeRim(g));
        if (web < Math.min(h.d, g.d)) pitch.push(`${nm}–hole${i + k + 2} 肉厚 ${nf(web)}`);
      });
    });
  }));
  add('W08', '穴の縁端距離が穴径以上', 'warn', !edge.length, edge.join(' / '));
  add('W09', '穴どうしの肉厚が穴径以上', 'warn', !pitch.length, pitch.join(' / '));
  add('W10', '深穴ではない (深さ/径 ≤ 5)', 'warn', !deep.length, deep.join(' / '));
  add('W11', '薄すぎる寸法がない (1 mm 以上)', 'warn', !thin.length, thin.join(' / '));
  add('W19', '止まり穴の底の残り板厚が 1 mm 以上', 'warn', !shallow.length, shallow.join(' / '));
  add('W20', 'ねじの有効深さが呼び径以上、下穴が十分深い', 'warn', !threadShort.length && !threadDrill.length, [...threadShort, ...threadDrill].join(' / '));
  add('W21', '長穴の縁端距離が幅以上', 'warn', !slotEdge.length, slotEdge.join(' / '));
  add('W22', '斜め穴の角度が 45° 以下 (加工性)', 'warn', !steep.length, steep.join(' / '));
  // 1 つの部品を構成する立体は融合して出力する。 離れていて融合できない立体があるときは、別の立体のまま出力するので知らせる
  const apart = ((interference && interference.parts) || []).filter((x) => x.solids > 1);
  add('W23', '1 つの部品に離れた立体がない', 'warn', !apart.length, apart.map((x) => `部品「${x.name}」に離れた立体があります (${x.solids} 個。別の立体のまま出力します)`).join(' / '));
  add('I01', '穴の公差・はめあいの指定', 'info', !fitMiss.length, `未指定 (普通公差になります): ${fitMiss.join('、')}`);
  add('I02', '注記の記入', 'info', P.notes.length > 0, 'project の notes に加工指示を書けます');
  const fits = findFits(solids);
  if (fits.length) {
    add('I03', '軸と穴の組み合わせ (すきま = 穴径 − 軸径)', 'info', false,
      fits.map((f) => `${f.shaft} ⇔ ${f.hole}: φ${nf(f.dShaft)}${f.tol ? ' ' + f.tol : ''} / φ${nf(f.dHole)}${f.fit ? ' ' + f.fit : ''} → ${f.clearance > 0 ? 'すきま ' + nf(f.clearance) : f.clearance < 0 ? 'しめしろ ' + nf(-f.clearance) : 'すきま 0'} mm`).join(' / '));
  }
  return rules;
}

/* ---------- 案件・版・承認 ---------- */
function hashSpec(spec) {
  const str = JSON.stringify(spec, (k, v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
function nextRev(rev) {
  const r = String(rev || '').trim();
  if (!r) return 'A';
  if (/^\d+$/.test(r)) return String(+r + 1);
  if (/^[A-Y]$/i.test(r)) return String.fromCharCode(r.charCodeAt(0) + 1);
  return r + '1';
}
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ---------- 検図レポート・納品物 ---------- */
function checkReport(ctx, approval, history) {
  const { project: P, rules, drawing, bom } = ctx;
  const L = [];
  L.push(`# 検図レポート: ${P.title || '(図名未記入)'}`, '');
  L.push(`- 図番: ${P.drawing_no || '-'} / 版: ${P.rev || '-'} / 材質: ${P.material || '-'}`);
  L.push(`- 尺度: ${scaleText(drawing.scale)} / 用紙: ${P.paper}${ctx.noProj ? '' : ' / 投影法: 第三角法'}`);
  L.push(`- 設計: ${P.designer || '-'} / 作図: ${P.drafter || '-'} / 作成日: ${P.date || '-'} / 納期: ${P.due || '-'}`);
  L.push(`- 出力日時: ${new Date().toLocaleString('ja-JP')}`, '');
  L.push('## 承認', approval ? `- 検図者: ${approval.by} (${approval.at})${approval.warnAck ? ' / 警告は確認済み' : ''}` : '- 未承認', '');
  L.push('## チェック結果', '', '| 結果 | ID | 項目 | 備考 |', '|---|---|---|---|');
  const mk = (r) => (r.ok ? 'OK' : r.sev === 'error' ? 'NG(エラー)' : r.sev === 'warn' ? 'NG(警告)' : '指摘(情報)');
  rules.forEach((r) => L.push(`| ${mk(r)} | ${r.id} | ${r.name} | ${r.ok ? '' : r.detail} |`));
  if (bom) {
    L.push('', '## 部品表', '', '| 品番 | 部品名 | 図番 | 材質 | 数量 |', '|---|---|---|---|---|');
    bom.forEach((r) => L.push(`| ${r.no} | ${r.title} | ${r.drawing_no || `${P.drawing_no}-${r.no}`} | ${r.material || '-'} | ${r.qty} |`));
  }
  L.push('', '## 改訂履歴', '', '| 版 | 日付 | 内容 | 検図者 |', '|---|---|---|---|');
  history.forEach((h) => L.push(`| ${h.rev} | ${h.date} | ${h.note} | ${h.by || '-'} |`));
  return L.join('\n') + '\n';
}

/* ---------- ZIP (無圧縮) ---------- */
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files) {
  const enc = new TextEncoder(), chunks = [], central = [];
  let off = 0;
  const dt = new Date();
  const dosTime = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1);
  const dosDate = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
  files.forEach((f) => {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    chunks.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  });
  const cd = central.reduce((a, x) => a + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cd, true); e.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}

/* ---------- STEP / IFC (ISO 10303-21) の文字列 ---------- */
// 機械部品の STEP は計算エンジン (src/kernel-worker.js) が作る。 ここは、IFC (建築) と STEP のヘッダ用の文字列変換だけ
function stepStr(s) {
  let out = '', buf = '';
  const flush = () => { if (buf) { out += `\\X2\\${buf}\\X0\\`; buf = ''; } };
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c < 0x7f) { flush(); out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch; }
    else if (c <= 0xffff) buf += c.toString(16).toUpperCase().padStart(4, '0');
    else buf += '003F'; // BMP 外は ? に置換
  }
  flush();
  return out;
}
