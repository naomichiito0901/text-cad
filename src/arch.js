/* =====================================================================
 * 建築ワークフロー (工程1〜6)
 *   室の解析 / 整合チェック / 建具表 / 平面図・立面図 / 検図 / IFC 出力
 * ===================================================================== */
const ARCH_SCALES = [1 / 10, 1 / 20, 1 / 30, 1 / 50, 1 / 100, 1 / 200, 1 / 300, 1 / 500, 1 / 1000];
const isArchScale = (s) => ARCH_SCALES.some((x) => Math.abs(x - s) < 1e-9);
const HABITABLE = ['洋室', '和室', '居室', '寝室', 'リビング', '居間', 'LDK', 'DK', 'ダイニング', '子供部屋', '書斎', '客間', '応接', '事務室', '執務'];
const isHabitable = (name) => HABITABLE.some((k) => String(name).includes(k));
const DIR_NAME = { S: '南', N: '北', E: '東', W: '西' };

/* ---------- 建具表 (同じ寸法の建具は同じ記号) ---------- */
function buildSchedule(a) {
  const map = new Map();
  [['door', 'D'], ['window', 'W']].forEach(([kind, pre]) => {
    let n = 0;
    a.walls.forEach((w) => w.open.filter((o) => o.kind === kind).forEach((o) => {
      const key = `${kind}|${o.width}|${o.height}|${o.sill ?? 0}`;
      if (!map.has(key)) { n += 1; map.set(key, { mark: pre + n, kind, width: o.width, height: o.height, sill: o.sill || 0, qty: 0 }); }
      const r = map.get(key); r.qty += 1; o.mark = r.mark;
    }));
  });
  return [...map.values()];
}

/* ---------- 室の解析 (壁で囲まれた領域の面積・採光・出入口) ---------- */
function analyzeArch(a) {
  const pts = [];
  a.walls.forEach((w) => pts.push(w.a, w.b));
  const maxT = Math.max(...a.walls.map((w) => w.t));
  const bx0 = Math.min(...pts.map((p) => p[0])) - maxT * 2, bx1 = Math.max(...pts.map((p) => p[0])) + maxT * 2;
  const by0 = Math.min(...pts.map((p) => p[1])) - maxT * 2, by1 = Math.max(...pts.map((p) => p[1])) + maxT * 2;
  const c = Math.max(50, Math.sqrt((bx1 - bx0) * (by1 - by0) / 6e5));
  const nx = Math.ceil((bx1 - bx0) / c) + 1, ny = Math.ceil((by1 - by0) / c) + 1;
  const grid = new Uint8Array(nx * ny), region = new Int16Array(nx * ny).fill(-1);
  a.walls.forEach((w) => {
    const e = w.t / 2, cs = [wp(w, -e, -e), wp(w, w.L + e, -e), wp(w, w.L + e, e), wp(w, -e, e)];
    const ix0 = Math.max(0, Math.floor((Math.min(...cs.map((p) => p[0])) - bx0) / c)), ix1 = Math.min(nx - 1, Math.ceil((Math.max(...cs.map((p) => p[0])) - bx0) / c));
    const iy0 = Math.max(0, Math.floor((Math.min(...cs.map((p) => p[1])) - by0) / c)), iy1 = Math.min(ny - 1, Math.ceil((Math.max(...cs.map((p) => p[1])) - by0) / c));
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = bx0 + (ix + 0.5) * c, y = by0 + (iy + 0.5) * c;
        const u = (x - w.a[0]) * w.d[0] + (y - w.a[1]) * w.d[1], v = (x - w.a[0]) * w.n[0] + (y - w.a[1]) * w.n[1];
        if (u >= -e && u <= w.L + e && Math.abs(v) <= e) grid[iy * nx + ix] = 1;
      }
    }
  });
  const cellOf = (x, y) => {
    const ix = Math.floor((x - bx0) / c), iy = Math.floor((y - by0) / c);
    return ix < 0 || iy < 0 || ix >= nx || iy >= ny ? -1 : iy * nx + ix;
  };
  const rayHit = (px, py, dx, dy) => {
    let best = Infinity;
    a.walls.forEach((w) => {
      const e = w.t / 2;
      const ox = (px - w.a[0]) * w.d[0] + (py - w.a[1]) * w.d[1], oy = (px - w.a[0]) * w.n[0] + (py - w.a[1]) * w.n[1];
      const rx = dx * w.d[0] + dy * w.d[1], ry = dx * w.n[0] + dy * w.n[1];
      let t0 = 0, t1 = Infinity, ok = true;
      const slab = (o, r, lo, hi) => {
        if (Math.abs(r) < 1e-12) { if (o < lo || o > hi) ok = false; return; }
        let ta = (lo - o) / r, tb = (hi - o) / r;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      };
      slab(ox, rx, -e, w.L + e); slab(oy, ry, -e, e);
      if (ok && t0 <= t1 && t1 > 0) best = Math.min(best, Math.max(t0, 0));
    });
    return best;
  };
  const queue = new Int32Array(nx * ny);
  const rooms = a.rooms.map((r, idx) => {
    const out = { idx, name: r.name, at: r.at, enclosed: false, inWall: false, area: 0, exact: false, rect: null, shared: -1 };
    const s0 = cellOf(r.at[0], r.at[1]);
    if (s0 < 0 || grid[s0]) { out.inWall = true; return out; }
    if (region[s0] >= 0) { out.shared = region[s0]; out.enclosed = true; return out; }
    let head = 0, tail = 0, leaked = false;
    queue[tail++] = s0; region[s0] = idx;
    while (head < tail) {
      const i = queue[head++], ix = i % nx, iy = (i - ix) / nx;
      if (ix === 0 || iy === 0 || ix === nx - 1 || iy === ny - 1) leaked = true;
      for (const j of [i - 1, i + 1, i - nx, i + nx]) {
        if (j < 0 || j >= nx * ny || grid[j] || region[j] >= 0) continue;
        if ((j === i - 1 && ix === 0) || (j === i + 1 && ix === nx - 1)) continue;
        region[j] = idx; queue[tail++] = j;
      }
    }
    if (leaked) { for (let k = 0; k < tail; k++) region[queue[k]] = -1; return out; }
    out.enclosed = true;
    const rasterArea = tail * c * c;
    const l = rayHit(r.at[0], r.at[1], -1, 0), rr = rayHit(r.at[0], r.at[1], 1, 0), u = rayHit(r.at[0], r.at[1], 0, 1), d = rayHit(r.at[0], r.at[1], 0, -1);
    const rectArea = (l + rr) * (u + d);
    if ([l, rr, u, d].every(Number.isFinite) && Math.abs(rasterArea - rectArea) <= 0.04 * rectArea) {
      out.exact = true; out.area = rectArea / 1e6;
      out.rect = { x0: r.at[0] - l, y0: r.at[1] - d, x1: r.at[0] + rr, y1: r.at[1] + u };
    } else out.area = rasterArea / 1e6;
    return out;
  });
  rooms.forEach((r) => { if (r.shared >= 0) { const o = rooms[r.shared]; r.area = o.area; r.exact = o.exact; r.rect = o.rect; } });
  const regionAt = (x, y) => { const i = cellOf(x, y); return i < 0 ? -1 : region[i]; };

  // 開口部がどの室に面しているか
  const openInfo = [];
  a.walls.forEach((w, wi) => w.open.forEach((op) => {
    const uc = (op.u0 + op.u1) / 2, off = w.t / 2 + 2 * c + 20;
    const sides = [regionAt(...wp(w, uc, off)), regionAt(...wp(w, uc, -off))];
    openInfo.push({ op, wall: wi, sides });
  }));
  const roomWin = new Map(); // 室ごとの窓面積(m²)
  openInfo.filter((o) => o.op.kind === 'window').forEach((o) => {
    new Set(o.sides.filter((s) => s >= 0)).forEach((s) => roomWin.set(s, (roomWin.get(s) || 0) + o.op.width * o.op.height / 1e6));
  });
  const roomDoors = new Map();
  openInfo.filter((o) => o.op.kind === 'door').forEach((o) => {
    new Set(o.sides.filter((s) => s >= 0)).forEach((s) => roomDoors.set(s, (roomDoors.get(s) || 0) + 1));
  });
  rooms.forEach((r) => {
    const own = r.shared >= 0 ? r.shared : r.idx;
    r.window = roomWin.get(own) || 0; r.doors = roomDoors.get(own) || 0;
    r.lighting = r.area > 0 ? r.window / r.area : 0;
  });

  // 壁どうしの重複
  const overlaps = [];
  for (let i = 0; i < a.walls.length; i++) {
    for (let j = i + 1; j < a.walls.length; j++) {
      const wi = a.walls[i], wj = a.walls[j];
      if (Math.abs(wi.d[0] * wj.d[1] - wi.d[1] * wj.d[0]) > 1e-6) continue;
      const v = (wj.a[0] - wi.a[0]) * wi.n[0] + (wj.a[1] - wi.a[1]) * wi.n[1];
      if (Math.abs(v) >= (wi.t + wj.t) / 2 - 1e-6) continue;
      const sj = (wj.a[0] - wi.a[0]) * wi.d[0] + (wj.a[1] - wi.a[1]) * wi.d[1];
      const ej = (wj.b[0] - wi.a[0]) * wi.d[0] + (wj.b[1] - wi.a[1]) * wi.d[1];
      const ov = Math.min(wi.L, Math.max(sj, ej)) - Math.max(0, Math.min(sj, ej));
      if (ov > Math.min(wi.t, wj.t) + 1) overlaps.push({ i: i + 1, j: j + 1, length: ov });
    }
  }

  // ドアの開き領域 (四分円) と壁・他のドアとの干渉
  const solidAt = (w, x, y) => {
    const u = (x - w.a[0]) * w.d[0] + (y - w.a[1]) * w.d[1], v = (x - w.a[0]) * w.n[0] + (y - w.a[1]) * w.n[1];
    return Math.abs(v) < w.t / 2 - 2 && w.solids.some(([s, e]) => u > s + 2 && u < e - 2);
  };
  const swings = [];
  a.walls.forEach((w, wi) => w.open.filter((o) => o.kind === 'door').forEach((op) => {
    const sgn = op.swing === 'left' ? 1 : -1, dsg = op.hinge === 'start' ? 1 : -1, hu = op.hinge === 'start' ? op.u0 : op.u1;
    swings.push({ op, wi, H: wp(w, hu, 0), dir: [w.d[0] * dsg, w.d[1] * dsg], nv: [w.n[0] * sgn, w.n[1] * sgn], r: op.width });
  }));
  const inQuarter = (s, x, y) => {
    const px = x - s.H[0], py = y - s.H[1];
    return Math.hypot(px, py) <= s.r && px * s.dir[0] + py * s.dir[1] >= 0 && px * s.nv[0] + py * s.nv[1] >= 0;
  };
  const swingHits = [];
  swings.forEach((s, si) => {
    const hitWalls = new Set(), hitDoors = new Set();
    for (const rf of [0.2, 0.45, 0.7, 0.95]) {
      for (const deg of [8, 25, 45, 65, 82]) {
        const ph = deg * Math.PI / 180;
        const x = s.H[0] + s.r * rf * (Math.cos(ph) * s.dir[0] + Math.sin(ph) * s.nv[0]);
        const y = s.H[1] + s.r * rf * (Math.cos(ph) * s.dir[1] + Math.sin(ph) * s.nv[1]);
        a.walls.forEach((w, wi) => { if (wi !== s.wi && solidAt(w, x, y)) hitWalls.add(wi + 1); });
        swings.forEach((o, oi) => { if (oi !== si && inQuarter(o, x, y)) hitDoors.add(oi); });
      }
    }
    hitWalls.forEach((w) => swingHits.push({ door: s.op.key, mark: s.op.mark, with: `壁${w}` }));
    hitDoors.forEach((oi) => { if (oi > si) swingHits.push({ door: s.op.key, mark: s.op.mark, with: `ドア ${swings[oi].op.key}` }); });
  });
  return { rooms, overlaps, swingHits, openInfo, cell: c, totalArea: rooms.filter((r) => r.enclosed && r.shared < 0).reduce((t, r) => t + r.area, 0) };
}

/* ---------- 図面 (平面図・立面図) の共通処理 ---------- */
function sideOfWall(w, ext) {
  const horiz = Math.abs(w.d[1]) < 1e-9, vert = Math.abs(w.d[0]) < 1e-9, tol = w.t / 2 + 1;
  if (horiz) { if (Math.abs(w.a[1] - ext.y0) <= tol) return 'S'; if (Math.abs(w.a[1] - ext.y1) <= tol) return 'N'; }
  if (vert) { if (Math.abs(w.a[0] - ext.x0) <= tol) return 'W'; if (Math.abs(w.a[0] - ext.x1) <= tol) return 'E'; }
  return null;
}
function centerlineExtent(a) {
  const pts = [];
  a.walls.forEach((w) => pts.push(w.a, w.b));
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) };
}
function archEmit(prims) {
  const T = (s, x, y, h, o = {}) => prims.push({ t: 'text', p: [x, y], h, s: String(s), layer: o.layer || 'TEXT', anchor: o.anchor || 'middle', rot: o.rot || 0 });
  const LN = (p, q, l) => prims.push(line(p, q, l));
  const arrow = (tip, d) => {
    const n = [-d[1], d[0]];
    prims.push({ t: 'poly', layer: 'DIM', fill: true, pts: [tip, [tip[0] + d[0] * 3 + n[0] * 0.9, tip[1] + d[1] * 3 + n[1] * 0.9], [tip[0] + d[0] * 3 - n[0] * 0.9, tip[1] + d[1] * 3 - n[1] * 0.9]] });
  };
  // 寸法列: P=紙面上の点列(線上で昇順) n=外向き単位ベクトル off=寸法線までの距離(mm)
  const chain = (P, n, off, labels) => {
    const e = P[P.length - 1], s0 = P[0], L = Math.hypot(e[0] - s0[0], e[1] - s0[1]);
    let d = [(e[0] - s0[0]) / L, (e[1] - s0[1]) / L];
    if (d[0] < -1e-9 || (Math.abs(d[0]) <= 1e-9 && d[1] < 0)) d = [-d[0], -d[1]];
    const tn = [-d[1], d[0]], rot = Math.atan2(d[1], d[0]) * 180 / Math.PI;
    P.forEach((p) => LN([p[0] + n[0] * 1.5, p[1] + n[1] * 1.5], [p[0] + n[0] * (off + 2), p[1] + n[1] * (off + 2)], 'DIM'));
    for (let i = 0; i < P.length - 1; i++) {
      const A = [P[i][0] + n[0] * off, P[i][1] + n[1] * off], B = [P[i + 1][0] + n[0] * off, P[i + 1][1] + n[1] * off];
      const sl = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (sl < 0.3) continue;
      const u = [(B[0] - A[0]) / sl, (B[1] - A[1]) / sl];
      LN(A, B, 'DIM'); arrow(A, u); arrow(B, [-u[0], -u[1]]);
      T(labels[i], (A[0] + B[0]) / 2 + tn[0] * 1.3, (A[1] + B[1]) / 2 + tn[1] * 1.3, 3, { layer: 'DIM', rot });
    }
  };
  const table = (x, yTop, cols, heads, rows, minY) => {
    const RH = 6;
    let y = yTop;
    const row = (vals, head) => {
      let cx = x;
      vals.forEach((v, i) => {
        prims.push(...rectLines(cx, y - RH, cx + cols[i], y, 'TBLOCK'));
        const hh = head ? 3 : 3.2, tw = textW(v, hh), hs = tw > cols[i] - 2 ? Math.max(1.4, hh * (cols[i] - 2) / tw) : hh;
        T(v, cx + cols[i] / 2, y - 4.2, hs, { layer: 'TEXT' });
        cx += cols[i];
      });
      y -= RH;
    };
    row(heads, true);
    for (const r of rows) { if (y - RH < minY) { T('…(以下省略)', x + 2, y - 4, 2.6, { anchor: 'start' }); break; } row(r, false); }
    return y;
  };
  return { T, LN, arrow, chain, table };
}
function pickScale(proj, fitsFn) {
  if (proj.scale === 'auto') {
    const s = [...ARCH_SCALES].sort((p, q) => q - p).find(fitsFn);
    return s ? { s, fits: true } : { s: ARCH_SCALES[ARCH_SCALES.length - 1], fits: false };
  }
  return { s: proj.scale, fits: fitsFn(proj.scale) };
}
function newSheet(proj) {
  const [SW, SH] = PAPERS[proj.paper];
  const prims = [{ t: 'poly', pts: [[0, 0], [SW, 0], [SW, SH], [0, SH]], layer: 'PAPER', view: true }];
  prims.push(...rectLines(0, 0, SW, SH, 'TBLOCK'), ...rectLines(20, 10, SW - 10, SH - 10, 'FRAME'));
  return { prims, SW, SH, fl: 20, fr: SW - 10, fb: 10, ft: SH - 10, TBH: 40 };
}
const archDecor = (prims, proj, revRows, s, kindLabel) => sheetDecor(prims, {
  proj, revRows, scaleStr: scaleText(s), asm: false,
  labels: { material: '構造', kind: ['図の種類', kindLabel], tol: '寸法基準', tolValue: '壁芯 / mm', noTolNote: true },
});
const xfPrim = (p, f, s) => {
  if (p.t === 'line') return { ...p, a: f(p.a), b: f(p.b) };
  if (p.t === 'poly') return { ...p, pts: p.pts.map(f) };
  if (p.t === 'circle') return { ...p, c: f(p.c), r: p.r * s };
  if (p.t === 'arc') return { ...p, c: f(p.c), r: p.r * s };
  return { ...p, p: f(p.p), h: p.h * s };
};

/* ---------- 平面図 ---------- */
function planDrawing(a, an, sched, proj, revRows) {
  const sh = newSheet(proj), { prims, fl, fr, fb, ft, TBH } = sh;
  const E = archEmit(prims), auto = proj.dimensions === 'auto';
  const need = new Set(), have = new Set();
  const ce = centerlineExtent(a), maxT = Math.max(...a.walls.map((w) => w.t));
  const ob = { x0: ce.x0 - maxT / 2, x1: ce.x1 + maxT / 2, y0: ce.y0 - maxT / 2, y1: ce.y1 + maxT / 2 };
  const Wb = ob.x1 - ob.x0, Db = ob.y1 - ob.y0;
  const nRev = Math.min(revRows.length, 4), topStrip = 14 + (nRev ? 6 * (nRev + 1) : 0);
  const withTables = an.rooms.length > 0 || sched.length > 0, tableW = withTables ? 100 : 0, M = auto ? 38 : 8;
  const rx0 = fl + 6 + M, rx1 = fr - 6 - tableW - M, ry0 = fb + TBH + 6 + M, ry1 = ft - topStrip - M;
  const { s, fits } = pickScale(proj, (sc) => Wb * sc <= rx1 - rx0 && Db * sc <= ry1 - ry0);
  const ox = rx0 + Math.max(0, ((rx1 - rx0) - Wb * s) / 2), oy = ry0 + Math.max(0, ((ry1 - ry0) - Db * s) / 2);
  const PX = (x) => ox + (x - ob.x0) * s, PY = (y) => oy + (y - ob.y0) * s, P = (p) => [PX(p[0]), PY(p[1])];
  archPlanPrims(a).forEach((p) => prims.push(xfPrim(p, P, s)));

  // 建具記号 (扉は開き側と反対、窓は建物の外側)
  const cen = [(ce.x0 + ce.x1) / 2, (ce.y0 + ce.y1) / 2];
  a.walls.forEach((w) => w.open.forEach((op) => {
    if (!op.mark) return;
    let side;
    if (op.kind === 'door') side = op.swing === 'left' ? -1 : 1;
    else { const m = wp(w, (op.u0 + op.u1) / 2, 0), plus = wp(w, (op.u0 + op.u1) / 2, 1); side = Math.hypot(plus[0] - cen[0], plus[1] - cen[1]) > Math.hypot(m[0] - cen[0], m[1] - cen[1]) ? 1 : -1; }
    const base = P(wp(w, (op.u0 + op.u1) / 2, 0));
    E.T(op.mark, base[0] + w.n[0] * side * (w.t / 2 * s + 3.5), base[1] + w.n[1] * side * (w.t / 2 * s + 3.5) - 1, 2.8, { layer: op.kind === 'door' ? 'DOOR' : 'WINDOW' });
  }));

  // 寸法 (壁芯基準)
  a.walls.forEach((w) => w.open.forEach((op) => need.add(`open:${op.key}`)));
  const bySide = { S: [], N: [], E: [], W: [] };
  a.walls.forEach((w, i) => { const sd = sideOfWall(w, ce); if (sd) bySide[sd].push(w); else need.add(`wall${i + 1}`); });
  Object.keys(bySide).forEach((k) => { if (bySide[k].length) need.add(`side:${k}`); });
  if (auto) {
    const uniqSorted = (v) => { const r = []; v.sort((p, q) => p - q).forEach((x) => { if (!r.length || x - r[r.length - 1] > 1e-3) r.push(x); }); return r; };
    Object.entries(bySide).forEach(([sd, ws]) => {
      if (!ws.length) return;
      const horiz = sd === 'S' || sd === 'N', axis = horiz ? 0 : 1;
      const vals = [];
      ws.forEach((w) => {
        [0, w.L].forEach((u) => vals.push(wp(w, u, 0)[axis]));
        w.open.forEach((op) => { vals.push(wp(w, op.u0, 0)[axis], wp(w, op.u1, 0)[axis]); have.add(`open:${op.key}`); });
      });
      const xs = uniqSorted(vals);
      const edgePos = sd === 'S' ? ob.y0 : sd === 'N' ? ob.y1 : sd === 'W' ? ob.x0 : ob.x1;
      const n = sd === 'S' ? [0, -1] : sd === 'N' ? [0, 1] : sd === 'W' ? [-1, 0] : [1, 0];
      const pt = (v) => (horiz ? [PX(v), PY(edgePos)] : [PX(edgePos), PY(v)]);
      if (xs.length > 2) E.chain(xs.map(pt), n, 10, xs.slice(1).map((v, i) => nf(Math.round(v - xs[i]))));
      E.chain([pt(xs[0]), pt(xs[xs.length - 1])], n, xs.length > 2 ? 19 : 10, [nf(Math.round(xs[xs.length - 1] - xs[0]))]);
      have.add(`side:${sd}`);
    });
    a.walls.forEach((w, i) => {
      if (sideOfWall(w, ce)) return;
      const us = [0, w.L];
      w.open.forEach((op) => { us.push(op.u0, op.u1); have.add(`open:${op.key}`); });
      us.sort((p, q) => p - q);
      const uu = us.filter((v, k) => k === 0 || v - us[k - 1] > 1e-3);
      const mid = wp(w, w.L / 2, 0);
      const sgn = Math.hypot(mid[0] + w.n[0] - cen[0], mid[1] + w.n[1] - cen[1]) >= Math.hypot(mid[0] - w.n[0] - cen[0], mid[1] - w.n[1] - cen[1]) ? 1 : -1;
      E.chain(uu.map((u) => P(wp(w, u, sgn * w.t / 2))), [w.n[0] * sgn, w.n[1] * sgn], 8, uu.slice(1).map((v, k) => nf(Math.round(v - uu[k]))));
      have.add(`wall${i + 1}`);
    });
  } else E.T('※ 寸法は未記入です (dimensions: none)', ox, oy - 10, 3.6, { anchor: 'start' });

  // 表 (室面積・建具)
  if (withTables) {
    const tx0 = fr - 95, minY = fb + TBH + 4;
    let y = ft - topStrip - 2;
    if (an.rooms.length) {
      E.T('室面積表', tx0, y - 4, 3.6, { anchor: 'start' });
      const rows = an.rooms.map((r) => [r.name || '-', r.enclosed ? `${(Math.round(r.area * 100) / 100).toFixed(2)}${r.exact ? '' : '※'}` : '—']);
      rows.push(['合計', `${(Math.round(an.totalArea * 100) / 100).toFixed(2)}`]);
      y = E.table(tx0, y - 6, [60, 35], ['室名', '面積 (㎡)'], rows, minY) - 8;
    }
    if (sched.length) {
      E.T('建具表', tx0, y - 4, 3.6, { anchor: 'start' });
      E.table(tx0, y - 6, [15, 14, 30, 22, 14], ['記号', '種別', '幅×高さ', '腰高', '数量'],
        sched.map((r) => [r.mark, r.kind === 'door' ? '扉' : '窓', `${nf(r.width)}×${nf(r.height)}`, r.kind === 'window' ? nf(r.sill) : '—', r.qty]), minY);
    }
  }
  archDecor(prims, proj, revRows, s, '平面図');
  return { prims, scale: s, fits, need: [...need], have: [...have], paper: proj.paper, roughness: [], bbox: { W: Wb, D: Db, H: a.H }, title: proj.title, drawing_no: proj.drawing_no };
}

/* ---------- 立面図 ---------- */
function elevDrawing(a, sched, proj, revRows, dir) {
  const ce = centerlineExtent(a);
  const ws = a.walls.filter((w) => sideOfWall(w, ce) === dir);
  if (!ws.length) return null;
  const U = { S: (p) => p[0], N: (p) => -p[0], E: (p) => p[1], W: (p) => -p[1] }[dir];
  const sh = newSheet(proj), { prims, fl, fr, fb, ft, TBH } = sh;
  const E = archEmit(prims), auto = proj.dimensions === 'auto';
  const need = new Set([`elev:${dir}:w`, `elev:${dir}:h`]), have = new Set();
  let u0 = Infinity, u1 = -Infinity;
  ws.forEach((w) => { [wp(w, -w.t / 2, 0), wp(w, w.L + w.t / 2, 0)].forEach((p) => { u0 = Math.min(u0, U(p)); u1 = Math.max(u1, U(p)); }); });
  const ops = [];
  ws.forEach((w) => w.open.forEach((op) => {
    const x = U(wp(w, op.u0, 0)), y = U(wp(w, op.u1, 0));
    ops.push({ op, a: Math.min(x, y), b: Math.max(x, y), z0: op.kind === 'door' ? 0 : op.sill, z1: op.kind === 'door' ? op.height : op.sill + op.height });
  }));
  const H = a.H, Wb = u1 - u0;
  const nRev = Math.min(revRows.length, 4), topStrip = 14 + (nRev ? 6 * (nRev + 1) : 0);
  const mL = 12, mR = auto ? 34 : 8, mB = auto ? 40 : 14, mT = 12;
  const rx0 = fl + 6 + mL, rx1 = fr - 6 - mR, ry0 = fb + TBH + 6 + mB, ry1 = ft - topStrip - mT;
  const { s, fits } = pickScale(proj, (sc) => (Wb + 1600) * sc <= rx1 - rx0 && H * sc <= ry1 - ry0);
  const ox = rx0 + 800 * s + Math.max(0, ((rx1 - rx0) - (Wb + 1600) * s) / 2), oy = ry0 + Math.max(0, ((ry1 - ry0) - H * s) / 2);
  const PX = (u) => ox + (u - u0) * s, PY = (z) => oy + z * s;
  const L = (p, q, l) => E.LN([PX(p[0]), PY(p[1])], [PX(q[0]), PY(q[1])], l);
  const R = (a0, b0, a1, b1, l) => { L([a0, b0], [a1, b0], l); L([a1, b0], [a1, b1], l); L([a1, b1], [a0, b1], l); L([a0, b1], [a0, b0], l); };
  L([u0 - 800, 0], [u1 + 800, 0], 'OUTLINE');
  R(u0, 0, u1, H, 'OUTLINE');
  ops.forEach((o) => {
    R(o.a, o.z0, o.b, o.z1, o.op.kind === 'door' ? 'DOOR' : 'WINDOW');
    if (o.op.kind === 'window') L([(o.a + o.b) / 2, o.z0], [(o.a + o.b) / 2, o.z1], 'WINDOW');
    if (o.op.mark) E.T(o.op.mark, PX((o.a + o.b) / 2), PY((o.z0 + o.z1) / 2) - 1, 2.8, { layer: o.op.kind === 'door' ? 'DOOR' : 'WINDOW' });
  });
  if (auto) {
    const uniq = (v) => { const r = []; v.sort((p, q) => p - q).forEach((x) => { if (!r.length || x - r[r.length - 1] > 1e-3) r.push(x); }); return r; };
    const us = uniq([u0, u1, ...ops.flatMap((o) => [o.a, o.b])]);
    const gy = PY(0);
    if (us.length > 2) E.chain(us.map((u) => [PX(u), gy]), [0, -1], 10, us.slice(1).map((v, i) => nf(Math.round(v - us[i]))));
    E.chain([[PX(u0), gy], [PX(u1), gy]], [0, -1], us.length > 2 ? 19 : 10, [nf(Math.round(Wb))]);
    const zs = uniq([0, H, ...ops.flatMap((o) => [o.z0, o.z1])]);
    if (zs.length > 2) E.chain(zs.map((z) => [PX(u1), PY(z)]), [1, 0], 10, zs.slice(1).map((v, i) => nf(Math.round(v - zs[i]))));
    E.chain([[PX(u1), PY(0)], [PX(u1), PY(H)]], [1, 0], zs.length > 2 ? 19 : 10, [nf(Math.round(H))]);
    have.add(`elev:${dir}:w`); have.add(`elev:${dir}:h`);
  } else E.T('※ 寸法は未記入です (dimensions: none)', PX(u0), PY(0) - 12, 3.6, { anchor: 'start' });
  E.T(`${DIR_NAME[dir]}立面図`, PX(u0), PY(0) - (auto ? 33 : 8), 5, { anchor: 'start' });
  E.T(`S=${scaleText(s)}`, PX(u0) + 34, PY(0) - (auto ? 33 : 8), 3.4, { anchor: 'start' });
  const pj = { ...proj, title: `${proj.title} ${DIR_NAME[dir]}立面図`, drawing_no: `${proj.drawing_no}-${dir}` };
  archDecor(prims, pj, revRows, s, `${DIR_NAME[dir]}立面図`);
  return { prims, scale: s, fits, need: [...need], have: [...have], paper: proj.paper, roughness: [], bbox: { W: Wb, D: 0, H }, title: pj.title, drawing_no: pj.drawing_no };
}

function archDrawings(spec, a, an, sched, proj, revRows) {
  const out = [{ key: 'plan', label: '平面図', suffix: '_plan', d: planDrawing(a, an, sched, proj, revRows) }];
  let dirs = ['S', 'N', 'E', 'W'];
  if (spec.elevations === false || String(spec.elevations) === 'none') dirs = [];
  else if (Array.isArray(spec.elevations)) dirs = dirs.filter((d) => spec.elevations.map(String).map((x) => x.toUpperCase()).includes(d));
  dirs.forEach((dir) => {
    const d = elevDrawing(a, sched, proj, revRows, dir);
    if (d) out.push({ key: `elev${dir}`, label: `${DIR_NAME[dir]}立面図`, suffix: `_elev${dir}`, d });
  });
  return out;
}

/* ---------- 工程3・5: 整合チェックと検図 ---------- */
function runArchChecks(ctx) {
  const { project: P, a, an, drawings, sched } = ctx;
  const rules = [];
  const add = (id, name, sev, ok, detail) => rules.push({ id, name, sev, ok, detail: detail || '' });
  const labelOf = (k) => (PROJECT_FIELDS.find(([key]) => key === k) || [k, k])[1];
  const req = requiredKeys('arch');
  const missing = req.filter((k) => !P[k]).map(labelOf);
  add('E01', `案件情報の必須項目 (${req.map(labelOf).join('・')})`, 'error', !missing.length, missing.length ? `未記入: ${missing.join('、')}` : '');
  const dimMiss = drawings.map((dw) => ({ label: dw.label, miss: dw.d.need.filter((k) => !dw.d.have.includes(k)) })).filter((x) => x.miss.length);
  add('E02', '寸法の記入漏れ (全体寸法・開口部・壁)', 'error', !dimMiss.length,
    dimMiss.map((x) => `${x.label}: ${x.miss.length} 件 (${x.miss.slice(0, 4).join(', ')}${x.miss.length > 4 ? ' ...' : ''})`).join(' / '));
  add('E03', '壁どうしの重複 (同一直線上で重なっていない)', 'error', !an.overlaps.length, an.overlaps.map((o) => `壁${o.i}と壁${o.j} (重なり ${nf(Math.round(o.length))} mm)`).join(' / '));
  const nofit = drawings.filter((dw) => !dw.d.fits);
  add('E04', '図面が用紙に収まっている', 'error', !nofit.length, `${nofit.map((dw) => dw.label).join('、')}: 尺度 ${nofit[0] ? scaleText(nofit[0].d.scale) : ''} では ${P.paper} に収まりません。用紙か尺度を変更してください`);
  const open = an.rooms.filter((r) => !r.enclosed);
  add('E05', '部屋が壁で囲まれている (室名の位置が閉じた領域内)', 'error', !open.length,
    open.map((r) => `「${r.name || '(無名)'}」${r.inWall ? ' (壁の中にあります)' : ' (壁が閉じていません)'}`).join(' / '));
  const nonStd = drawings.filter((dw) => !isArchScale(dw.d.scale));
  add('W01', '尺度が規格尺度 (JIS Z 8314)', 'warn', !nonStd.length, nonStd.map((dw) => `${dw.label}: ${scaleText(dw.d.scale)}`).join(' / '));
  add('W02', '図面規格の指定', 'warn', !!P.standard, '例: standard: JIS A 0150');
  add('W06', '納期の指定と整合 (作成日以降)', 'warn', !!P.due && (!P.date || P.due >= P.date), !P.due ? '納期が未記入です' : '納期が作成日より前です');
  const narrow = [];
  a.walls.forEach((w) => w.open.filter((o) => o.kind === 'door' && o.width < 750).forEach((o) => narrow.push(`${o.key} (${nf(o.width)})`)));
  add('W13', '扉の幅が 750 mm 以上', 'warn', !narrow.length, narrow.join('、'));
  add('W14', '扉の開き領域が壁・他の扉と干渉しない', 'warn', !an.swingHits.length, an.swingHits.map((h) => `${h.door}${h.mark ? `(${h.mark})` : ''} × ${h.with}`).join(' / '));
  add('W15', '天井高(壁の高さ)が 2100 mm 以上', 'warn', a.H >= 2100, `height ${nf(a.H)} mm`);
  add('W17', '壁厚が 100 mm 以上', 'warn', a.walls.every((w) => w.t >= 100), a.walls.map((w, i) => (w.t < 100 ? `壁${i + 1} (${nf(w.t)})` : '')).filter(Boolean).join('、'));
  const dark = an.rooms.filter((r) => r.enclosed && isHabitable(r.name) && r.lighting < 1 / 7);
  add('W16', '居室の採光 (窓面積 ≥ 床面積の 1/7)', 'warn', !dark.length,
    dark.map((r) => `${r.name}: 窓 ${r.window.toFixed(2)}㎡ / 床 ${r.area.toFixed(2)}㎡ = 1/${r.lighting > 0 ? (1 / r.lighting).toFixed(1) : '∞'}`).join(' / '));
  const noDoor = an.rooms.filter((r) => r.enclosed && r.doors === 0);
  add('W18', '各室に出入口(扉)がある', 'warn', !noDoor.length, noDoor.map((r) => r.name).join('、'));
  add('I01', '部屋名の記入 (面積表・採光の確認に使います)', 'info', an.rooms.length > 0, 'rooms: に {name, at: [x, y]} を書いてください');
  add('I02', '注記の記入', 'info', P.notes.length > 0, 'project の notes に注記を書けます');
  const approx = an.rooms.filter((r) => r.enclosed && !r.exact);
  add('I03', '室面積は矩形(正確)', 'info', !approx.length, `矩形でない室は概算です (※): ${approx.map((r) => r.name).join('、')}`);
  return rules;
}
// 工程3(整合チェック)に表示する項目
function archIntegrity(a, an, rules) {
  const items = [], hot = new Set();
  an.overlaps.forEach((o) => { hot.add(`wall${o.i}`); hot.add(`wall${o.j}`); items.push({ sev: 'error', text: `壁${o.i} と 壁${o.j} が重複 (重なり ${nf(Math.round(o.length))} mm)` }); });
  an.rooms.filter((r) => !r.enclosed).forEach((r) => items.push({ sev: 'error', text: `「${r.name || '(無名)'}」が壁で囲まれていません` }));
  an.swingHits.forEach((h) => items.push({ sev: 'warn', text: `扉 ${h.door} の開き領域が ${h.with} と干渉` }));
  rules.filter((r) => ['W13', 'W16', 'W18'].includes(r.id) && !r.ok).forEach((r) => items.push({ sev: 'warn', text: `${r.name}: ${r.detail}` }));
  return { items, hot, okText: `壁 ${a.walls.length} / 扉 ${a.walls.reduce((t, w) => t + w.open.filter((o) => o.kind === 'door').length, 0)} / 窓 ${a.walls.reduce((t, w) => t + w.open.filter((o) => o.kind === 'window').length, 0)} / 室 ${an.rooms.length} を確認しました` };
}

/* ---------- 表 (CSV) ---------- */
function archCSVs(sched, an) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = (rows) => '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  return {
    schedule: csv([['記号', '種別', '幅', '高さ', '腰高', '数量'], ...sched.map((r) => [r.mark, r.kind === 'door' ? '扉' : '窓', r.width, r.height, r.kind === 'window' ? r.sill : '', r.qty])]),
    rooms: csv([['室名', '面積(㎡)', '面積の精度', '窓面積(㎡)', '採光比(窓/床)', '扉の数'],
      ...an.rooms.map((r) => [r.name, r.enclosed ? r.area.toFixed(2) : '', r.enclosed ? (r.exact ? '正確(矩形)' : '概算') : '囲まれていない', r.enclosed ? r.window.toFixed(2) : '', r.enclosed && r.area ? r.lighting.toFixed(3) : '', r.doors])]),
  };
}

/* ---------- IFC4 出力 ---------- */
function ifcGuid(seed) {
  let h = [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344];
  const str = String(seed);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    for (let k = 0; k < 4; k++) h[k] = Math.imul(h[k] ^ (c + k * 131), 0x9e3779b1) ^ (h[(k + 1) % 4] >>> 15);
  }
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) h[k] = Math.imul(h[k] ^ (h[(k + 1) % 4] >>> 13), 0x85ebca6b) ^ (h[(k + 3) % 4] >>> 16);
  let n = 0n;
  h.forEach((x) => { n = (n << 32n) | BigInt(x >>> 0); });
  const AB = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  let out = '';
  for (let i = 0; i < 22; i++) out += AB[Number((n >> BigInt(6 * (21 - i))) & 63n)];
  return out;
}
function toIFC(a, an, proj, fileName) {
  const L = [];
  let n = 0;
  const add = (s) => { n += 1; L.push(`#${n}=${s};`); return n; };
  const f = (v) => { let s = (Math.round(v * 1e6) / 1e6).toString(); if (/e/i.test(s)) s = v.toFixed(6); return s.includes('.') ? s : s + '.'; };
  const q = (s) => `'${stepStr(s)}'`;
  const g = (seed) => `'${ifcGuid(`${proj.drawing_no}|${seed}`)}'`;
  const pt3 = (x, y, z) => add(`IFCCARTESIANPOINT((${f(x)},${f(y)},${f(z)}))`);
  const pt2 = (x, y) => add(`IFCCARTESIANPOINT((${f(x)},${f(y)}))`);
  const dir3 = (x, y, z) => add(`IFCDIRECTION((${f(x)},${f(y)},${f(z)}))`);
  const dir2 = (x, y) => add(`IFCDIRECTION((${f(x)},${f(y)}))`);
  const Z = dir3(0, 0, 1), X = dir3(1, 0, 0);
  const ax3 = (p, z, x) => add(`IFCAXIS2PLACEMENT3D(#${p},#${z},#${x})`);
  const place = (rel, p, z, x) => add(`IFCLOCALPLACEMENT(${rel ? '#' + rel : '$'},#${ax3(p, z, x)})`);
  const rect = (cx, cy, xd, yd) => add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${add(`IFCAXIS2PLACEMENT2D(#${pt2(cx, cy)},#${dir2(1, 0)})`)},${f(xd)},${f(yd)})`);

  const len = add('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const area = add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const vol = add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const ang = add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const units = add(`IFCUNITASSIGNMENT((#${len},#${area},#${vol},#${ang}))`);
  const wcs = ax3(pt3(0, 0, 0), Z, X);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${wcs},$)`);
  const sub = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${ctx},$,.MODEL_VIEW.,$)`);
  const project = add(`IFCPROJECT(${g('project')},$,${q(proj.title || proj.drawing_no || 'Project')},$,$,$,$,(#${ctx}),#${units})`);
  const sitePl = place(null, pt3(0, 0, 0), Z, X);
  const site = add(`IFCSITE(${g('site')},$,'Site',$,$,#${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = place(sitePl, pt3(0, 0, 0), Z, X);
  const building = add(`IFCBUILDING(${g('building')},$,${q(proj.title || 'Building')},$,$,#${bldPl},$,$,.ELEMENT.,$,$,$)`);
  const stPl = place(bldPl, pt3(0, 0, 0), Z, X);
  const storey = add(`IFCBUILDINGSTOREY(${g('storey')},$,'1F',$,$,#${stPl},$,$,.ELEMENT.,0.)`);
  const rel = (kind, seed, args) => add(`${kind}(${g(seed)},$,$,$,${args})`);
  rel('IFCRELAGGREGATES', 'agg-p', `#${project},(#${site})`);
  rel('IFCRELAGGREGATES', 'agg-s', `#${site},(#${building})`);
  rel('IFCRELAGGREGATES', 'agg-b', `#${building},(#${storey})`);

  const body = (profile, z0, depth) => {
    const solid = add(`IFCEXTRUDEDAREASOLID(#${profile},#${ax3(pt3(0, 0, z0), Z, X)},#${Z},${f(depth)})`);
    const rep = add(`IFCSHAPEREPRESENTATION(#${sub},'Body','SweptSolid',(#${solid}))`);
    return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
  };
  const contained = [];
  a.walls.forEach((w, i) => {
    const pl = place(stPl, pt3(w.a[0], w.a[1], 0), Z, dir3(w.d[0], w.d[1], 0));
    const wall = add(`IFCWALL(${g(`wall${i}`)},$,${q(`壁${i + 1}`)},$,$,#${pl},#${body(rect(w.L / 2, 0, w.L + w.t, w.t), 0, a.H)},$,.STANDARD.)`);
    contained.push(wall);
    w.open.forEach((op) => {
      const z0 = op.kind === 'door' ? 0 : op.sill, h = op.height;
      const opl = place(pl, pt3(op.u0, 0, z0), Z, X);
      const opening = add(`IFCOPENINGELEMENT(${g(`op-${op.key}`)},$,${q(`開口 ${op.key}`)},$,$,#${opl},#${body(rect(op.width / 2, 0, op.width, w.t), 0, h)},$,.OPENING.)`);
      rel('IFCRELVOIDSELEMENT', `void-${op.key}`, `#${wall},#${opening}`);
      const fpl = place(pl, pt3(op.u0, 0, z0), Z, X);
      const shape = body(rect(op.width / 2, 0, op.width, 40), 0, h);
      const el = op.kind === 'door'
        ? add(`IFCDOOR(${g(`door-${op.key}`)},$,${q(op.mark || op.key)},$,$,#${fpl},#${shape},$,${f(h)},${f(op.width)},.DOOR.,.${op.swing === 'left' ? 'SINGLE_SWING_LEFT' : 'SINGLE_SWING_RIGHT'}.,$)`)
        : add(`IFCWINDOW(${g(`win-${op.key}`)},$,${q(op.mark || op.key)},$,$,#${fpl},#${shape},$,${f(h)},${f(op.width)},.WINDOW.,.SINGLE_PANEL.,$)`);
      rel('IFCRELFILLSELEMENT', `fill-${op.key}`, `#${opening},#${el}`);
      contained.push(el);
    });
  });
  if (a.floor) {
    const ce = centerlineExtent(a), maxT = Math.max(...a.walls.map((w) => w.t));
    const x0 = ce.x0 - maxT / 2, y0 = ce.y0 - maxT / 2, wv = ce.x1 - ce.x0 + maxT, hv = ce.y1 - ce.y0 + maxT;
    const pl = place(stPl, pt3(x0, y0, -100), Z, X);
    contained.push(add(`IFCSLAB(${g('slab')},$,${q('床')},$,$,#${pl},#${body(rect(wv / 2, hv / 2, wv, hv), 0, 100)},$,.FLOOR.)`));
  }
  rel('IFCRELCONTAINEDINSPATIALSTRUCTURE', 'contain', `(${contained.map((i) => '#' + i).join(',')}),#${storey}`);
  const spaces = [];
  an.rooms.filter((r) => r.enclosed && r.shared < 0).forEach((r, i) => {
    let pl, shape = '$';
    if (r.rect) {
      pl = place(stPl, pt3(r.rect.x0, r.rect.y0, 0), Z, X);
      const wv = r.rect.x1 - r.rect.x0, hv = r.rect.y1 - r.rect.y0;
      shape = `#${body(rect(wv / 2, hv / 2, wv, hv), 0, a.H)}`;
    } else pl = place(stPl, pt3(0, 0, 0), Z, X);
    const sp = add(`IFCSPACE(${g(`space${i}`)},$,${q(`R${i + 1}`)},$,$,#${pl},${shape},${q(r.name)},.ELEMENT.,.INTERNAL.,$)`);
    const qa = add(`IFCQUANTITYAREA('NetFloorArea',$,$,${f(r.area)},$)`);
    const eq = add(`IFCELEMENTQUANTITY(${g(`qto${i}`)},$,'Qto_SpaceBaseQuantities',$,$,(#${qa}))`);
    rel('IFCRELDEFINESBYPROPERTIES', `dp${i}`, `(#${sp}),#${eq}`);
    spaces.push(sp);
  });
  if (spaces.length) rel('IFCRELAGGREGATES', 'agg-sp', `#${storey},(${spaces.map((i) => '#' + i).join(',')})`);
  const stamp = new Date().toISOString().slice(0, 19);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');\nFILE_NAME(${q(fileName)},'${stamp}',(${q(proj.drafter || '')}),(''),'cad-text','cad-text','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${L.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
