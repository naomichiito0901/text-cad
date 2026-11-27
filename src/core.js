
/* =====================================================================
 * テキスト → CAD  (ブラウザ内で完結。外部への送信・保存は一切なし)
 * ===================================================================== */

/* ---------- 共通ユーティリティ ---------- */
class SpecError extends Error {}
const fail = (m) => { throw new SpecError(m); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function num(v, where, def) {
  if (v === undefined || v === null) {
    if (def !== undefined) return def;
    fail(`${where} が指定されていません`);
  }
  if (typeof v !== 'number' || !isFinite(v)) fail(`${where} は数値で指定してください (現在の値: ${JSON.stringify(v)})`);
  return v;
}
function pos(v, where, def) {
  const n = num(v, where, def);
  if (n <= 0) fail(`${where} は 0 より大きい値にしてください`);
  return n;
}
function vec(v, n, where, def) {
  if (v === undefined || v === null) {
    if (def) return def.slice();
    fail(`${where} が指定されていません`);
  }
  if (!Array.isArray(v) || v.length < 2 || v.length > n) {
    fail(`${where} は [${['x', 'y', 'z'].slice(0, n).join(', ')}] の形式で指定してください`);
  }
  const r = v.map((x, i) => num(x, `${where} の ${i + 1} 番目`));
  while (r.length < n) r.push(0);
  return r;
}
function list(spec, key, required) {
  const v = spec[key];
  if (v === undefined || v === null) {
    if (required) fail(`「${key}:」の一覧が必要です`);
    return [];
  }
  if (!Array.isArray(v)) fail(`「${key}:」は「- 項目」の形式の一覧で書いてください`);
  return v;
}

/* ---------- 2D 図形データ ---------- */
const LAYERS = {
  OUTLINE: { color: '#1f2937', aci: 7, w: 1.9 },
  HOLE: { color: '#dc2626', aci: 1 },
  WALL: { color: '#475569', aci: 8 },
  DOOR: { color: '#2563eb', aci: 5 },
  WINDOW: { color: '#0891b2', aci: 4 },
  SYMBOL: { color: '#111827', aci: 7 },
  WIRE: { color: '#16a34a', aci: 3 },
  TEXT: { color: '#374151', aci: 8 },
  DIM: { color: '#0f766e', aci: 3, w: 1 },
  HIDDEN: { color: '#475569', aci: 8, w: 1.1, dash: '5 3', lt: 'HIDDEN' },
  CENTER: { color: '#dc2626', aci: 1, w: 0.9, dash: '14 3 3 3', lt: 'CENTER' },
  FRAME: { color: '#111827', aci: 7, w: 2.4 },
  TBLOCK: { color: '#111827', aci: 7, w: 1.1 },
  PAPER: { color: '#cbd5e1', aci: 8 },
  HATCH: { color: '#64748b', aci: 8, w: 0.7 },
  THREAD: { color: '#1f2937', aci: 7, w: 0.8 },
};
const line = (a, b, layer) => ({ t: 'line', a, b, layer });
function rectLines(x0, y0, x1, y1, layer) {
  return [line([x0, y0], [x1, y0], layer), line([x1, y0], [x1, y1], layer),
          line([x1, y1], [x0, y1], layer), line([x0, y1], [x0, y0], layer)];
}

/* =====================================================================
 * 分野: 機械部品
 * ===================================================================== */
/* ---- 穴の形状(貫通・止まり・座ぐり・皿穴) ---- */
const THREADS = { M2: [0.4, 1.6], M2_5: [0.45, 2.05], M3: [0.5, 2.5], M4: [0.7, 3.3], M5: [0.8, 4.2], M6: [1, 5], M8: [1.25, 6.8], M10: [1.5, 8.5], M12: [1.75, 10.2], M14: [2, 12], M16: [2, 14], M20: [2.5, 17.5] };
const TDIRS = { '+x': [1, 0], '-x': [-1, 0], '+y': [0, 1], '-y': [0, -1] };
// 斜め穴: 上面の中心 (h.x,h.y) から下へ向かって tdir の向きに傾く。高さ z での軸の位置
const tiltT = (h) => Math.tan((h.tilt || 0) * Math.PI / 180), tiltC = (h) => Math.cos((h.tilt || 0) * Math.PI / 180);
const axisAt = (h, zTop, z) => [h.x + (h.tdir ? h.tdir[0] : 0) * (zTop - z) * tiltT(h), h.y + (h.tdir ? h.tdir[1] : 0) * (zTop - z) * tiltT(h)];
const cskDepth = (h) => (h.cskD - h.d) / 2 / Math.tan(h.cskAngle * Math.PI / 360);
const holeRim = (h) => Math.max(h.d, h.cbD || 0, h.cskD || 0) / 2 / (h.tilt ? tiltC(h) : 1);
// 上面から下へ穴の壁をたどる点列 [{r, z}] (止まりなら最後の点が底面)
function holeSteps(h, zTop, zBot) {
  const rh = h.d / 2, pts = [];
  if (h.kind === 'counterbore') pts.push({ r: h.cbD / 2, z: zTop }, { r: h.cbD / 2, z: zTop - h.cbDepth }, { r: rh, z: zTop - h.cbDepth });
  else if (h.kind === 'countersink') pts.push({ r: h.cskD / 2, z: zTop }, { r: rh, z: zTop - cskDepth(h) });
  else pts.push({ r: rh, z: zTop });
  const through = h.depth == null;
  pts.push({ r: rh, z: through ? zBot : zTop - h.depth });
  return { pts, through };
}
// 高さ z での穴の半径 (材料の中にいなければ -1)
function holeRadiusAt(h, zTop, zBot, z) {
  const { pts } = holeSteps(h, zTop, zBot);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.z - b.z > 1e-9 && z <= a.z && z >= b.z) return a.r + (b.r - a.r) * ((a.z - z) / (a.z - b.z));
  }
  return -1;
}
function holeText(h) {
  const t = [];
  if (h.thread) {
    t.push(h.thread.name);
    if (h.thread.depth != null) t.push(`ねじ深さ${nf(h.thread.depth)}`);
    t.push(`下穴φ${nf(h.d)}`);
  } else t.push(`φ${nf(h.d)}`);
  if (h.fit) t.push(h.fit);
  if (h.tol) t.push(h.tol);
  if (h.kind === 'counterbore') t.push(`座ぐり φ${nf(h.cbD)} 深さ${nf(h.cbDepth)}`);
  if (h.kind === 'countersink') t.push(`皿 φ${nf(h.cskD)}×${nf(h.cskAngle)}°`);
  if (h.depth != null) t.push(`深さ${nf(h.depth)}`);
  if (h.tilt) t.push(`傾斜${nf(h.tilt)}°`);
  return t.join(' ');
}
// 長穴: 全長 len・幅 w (両端は半円)。中心間距離は len-w
const slotSeg = (sl) => { const D = sl.len - sl.w, h = D / 2; return sl.dir === 'x' ? [[sl.cx - h, sl.cy], [sl.cx + h, sl.cy]] : [[sl.cx, sl.cy - h], [sl.cx, sl.cy + h]]; };
const distSeg = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0; return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t); };
const slotText = (sl) => `長穴 幅${nf(sl.w)} 長さ${nf(sl.len)}${sl.fit ? ' ' + sl.fit : ''}${sl.tol ? ' ' + sl.tol : ''}`;

function parseParts(items, label) {
  const boxes = new Map(), cyls = [], holeDefs = [], slotDefs = [];
  items.forEach((it, i) => {
    const w = `${label} の ${i + 1} 番目`;
    if (!isObj(it) || Object.keys(it).length !== 1) fail(`${w}: 「- box: {...}」の形式で書いてください`);
    const type = Object.keys(it)[0], p = it[type];
    const ww = `${w} (${type})`;
    if (!isObj(p)) fail(`${ww}: 値は {キー: 値, ...} の形式にしてください`);
    const opt = (k) => (p[k] === undefined || p[k] === null ? 0 : pos(p[k], `${ww} の ${k}`));
    if (type === 'box') {
      const name = String(p.name ?? `box${i + 1}`);
      if (boxes.has(name)) fail(`${ww}: name「${name}」が重複しています`);
      const size = vec(p.size, 3, `${ww} の size`);
      if (size.some((s) => s <= 0)) fail(`${ww}: size はすべて 0 より大きい値にしてください`);
      const cr = opt('corner_radius'), ct = opt('chamfer'), cb = opt('chamfer_bottom'), half = Math.min(size[0], size[1]) / 2;
      if (cr && (ct || cb)) fail(`${ww}: corner_radius と chamfer は同時に指定できません`);
      if (cr && cr >= half) fail(`${ww}: corner_radius は幅・奥行きの半分 (${nf(half)}) 未満にしてください`);
      if ((ct && ct >= half) || (cb && cb >= half)) fail(`${ww}: chamfer は幅・奥行きの半分 (${nf(half)}) 未満にしてください`);
      if (ct + cb >= size[2]) fail(`${ww}: 上下の chamfer の合計は高さ (${nf(size[2])}) 未満にしてください`);
      boxes.set(name, { name, size, at: vec(p.at, 3, `${ww} の at`, [0, 0, 0]), holes: [], slots: [], tol: sstr(p.tol), finish: sstr(p.finish), cr, ct, cb });
    } else if (type === 'cylinder') {
      const d = pos(p.diameter, `${ww} の diameter`), h = pos(p.height, `${ww} の height`);
      const ct = opt('chamfer'), cb = opt('chamfer_bottom'), ft = opt('fillet'), fb = opt('fillet_bottom');
      if (ct && ft) fail(`${ww}: 上端に chamfer と fillet は同時に指定できません`);
      if (cb && fb) fail(`${ww}: 下端に chamfer_bottom と fillet_bottom は同時に指定できません`);
      if ([ct, cb, ft, fb].some((v) => v >= d / 2)) fail(`${ww}: chamfer / fillet は半径 (${nf(d / 2)}) 未満にしてください`);
      if (ct + cb + ft + fb >= h) fail(`${ww}: 上下の chamfer / fillet の合計は高さ (${nf(h)}) 未満にしてください`);
      cyls.push({ name: String(p.name ?? `cylinder${i + 1}`), d, h, at: vec(p.at, 3, `${ww} の at`, [0, 0, 0]), tol: sstr(p.tol), finish: sstr(p.finish), ct, cb, ft, fb });
    } else if (type === 'hole') {
      holeDefs.push({ ww, p });
    } else if (type === 'slot') {
      slotDefs.push({ ww, p });
    } else {
      fail(`${ww}: 未対応の種類です (使えるのは box / cylinder / hole / slot)`);
    }
  });
  holeDefs.forEach(({ ww, p }) => {
    const target = String(p.target ?? '');
    const box = boxes.get(target);
    if (!box) fail(`${ww}: target「${target}」という box がありません`);
    const T = box.size[2];
    let thread = null;
    if (p.thread !== undefined) {
      const nm = String(p.thread).toUpperCase(), key = nm.replace('.', '_');
      if (!THREADS[key]) fail(`${ww}: thread は ${Object.keys(THREADS).map((k) => k.replace('_', '.')).join(' / ')} のいずれかです`);
      thread = { name: nm, D: parseFloat(nm.slice(1)), pitch: THREADS[key][0], drill: THREADS[key][1], depth: p.thread_depth === undefined ? null : pos(p.thread_depth, `${ww} の thread_depth`) };
    }
    const d = thread && p.diameter === undefined ? thread.drill : pos(p.diameter, `${ww} の diameter`);
    const at = vec(p.at, 2, `${ww} の at`);
    const types = ['through', 'blind', 'counterbore', 'countersink'];
    let kind = p.type === undefined ? null : String(p.type);
    if (kind !== null && !types.includes(kind)) fail(`${ww}: type は ${types.join(' / ')} のいずれかです`);
    if (!kind) kind = p.cbore_d !== undefined ? 'counterbore' : p.csk_d !== undefined ? 'countersink' : 'through';
    const h = { d, at, fit: sstr(p.fit), tol: sstr(p.tol), kind: kind === 'blind' ? 'through' : kind, depth: null, thread, tilt: 0 };
    if (p.tilt !== undefined) {
      h.tilt = pos(p.tilt, `${ww} の tilt`);
      if (h.tilt > 60) fail(`${ww}: tilt は 60° 以下にしてください`);
      const td = String(p.tilt_dir ?? '+x');
      if (!TDIRS[td]) fail(`${ww}: tilt_dir は +x / -x / +y / -y のいずれかです`);
      h.tdir = TDIRS[td];
      if (h.kind !== 'through' || p.depth !== undefined || thread) fail(`${ww}: 斜め穴は貫通の単純な穴だけに指定できます (座ぐり・皿穴・止まり穴・ねじとは併用不可)`);
    }
    if (p.depth !== undefined) {
      h.depth = pos(p.depth, `${ww} の depth`);
      if (h.depth >= T - 1e-9) fail(`${ww}: depth が板厚 (${nf(T)}) 以上です。貫通穴にする場合は depth を省略してください`);
    } else if (kind === 'blind') fail(`${ww}: 止まり穴(type: blind)には depth が必要です`);
    if (h.kind === 'counterbore') {
      h.cbD = pos(p.cbore_d, `${ww} の cbore_d`); h.cbDepth = pos(p.cbore_depth, `${ww} の cbore_depth`);
      if (h.cbD <= d) fail(`${ww}: cbore_d は穴径 φ${nf(d)} より大きくしてください`);
      if (h.cbDepth >= T - 1e-9 || (h.depth != null && h.cbDepth >= h.depth - 1e-9)) fail(`${ww}: cbore_depth は板厚${h.depth != null ? '・depth' : ''}未満にしてください`);
    } else if (h.kind === 'countersink') {
      h.cskD = pos(p.csk_d, `${ww} の csk_d`); h.cskAngle = pos(p.csk_angle, `${ww} の csk_angle`, 90);
      if (h.cskD <= d) fail(`${ww}: csk_d は穴径 φ${nf(d)} より大きくしてください`);
      if (h.cskAngle <= 10 || h.cskAngle >= 170) fail(`${ww}: csk_angle は 10 超 170 未満にしてください`);
      if (cskDepth(h) >= T - 1e-9 || (h.depth != null && cskDepth(h) >= h.depth - 1e-9)) fail(`${ww}: 皿穴の深さ (${nf(cskDepth(h))}) が板厚${h.depth != null ? '・depth' : ''}を超えます`);
    }
    if (thread && thread.depth != null && thread.depth > (h.depth != null ? h.depth : T) + 1e-9) fail(`${ww}: thread_depth は穴の深さ ${nf(h.depth != null ? h.depth : T)} 以下にしてください`);
    const r = holeRim(h), m = box.ct || 0;
    let bx0 = at[0] - r, bx1 = at[0] + r, by0 = at[1] - r, by1 = at[1] + r;
    if (h.tilt) { // 斜め穴は下面の楕円も範囲内にあること
      const sh = T * tiltT(h), ex = h.tdir[0] ? r : d / 2, ey = h.tdir[1] ? r : d / 2;
      bx0 = Math.min(at[0] - ex, at[0] + h.tdir[0] * sh - ex); bx1 = Math.max(at[0] + ex, at[0] + h.tdir[0] * sh + ex);
      by0 = Math.min(at[1] - ey, at[1] + h.tdir[1] * sh - ey); by1 = Math.max(at[1] + ey, at[1] + h.tdir[1] * sh + ey);
    }
    if (bx0 < m || bx1 > box.size[0] - m || by0 < m || by1 > box.size[1] - m) {
      fail(`${ww}: 穴 (φ${nf(r * 2)}) が box「${target}」(${box.size[0]} × ${box.size[1]}${m ? `、上面の面取り ${nf(m)} を除く` : ''}) からはみ出しています`);
    }
    if (box.cr) {
      [[box.cr, box.cr], [box.size[0] - box.cr, box.cr], [box.cr, box.size[1] - box.cr], [box.size[0] - box.cr, box.size[1] - box.cr]].forEach(([cx, cy], k) => {
        const inCorner = (k % 2 === 0 ? at[0] < cx : at[0] > cx) && (k < 2 ? at[1] < cy : at[1] > cy);
        if (inCorner && Math.hypot(at[0] - cx, at[1] - cy) + r > box.cr) fail(`${ww}: 穴が box「${target}」の角R (${nf(box.cr)}) にかかっています`);
      });
    }
    box.holes.forEach((o) => {
      if (Math.hypot(o.at[0] - at[0], o.at[1] - at[1]) < holeRim(o) + r) fail(`${ww}: box「${target}」の他の穴と重なっています`);
    });
    box.holes.push(h);
  });
  slotDefs.forEach(({ ww, p }) => {
    const target = String(p.target ?? ''), box = boxes.get(target);
    if (!box) fail(`${ww}: target「${target}」という box がありません`);
    const w = pos(p.width, `${ww} の width`), len = pos(p.length, `${ww} の length`), dir = String(p.dir ?? 'x');
    if (dir !== 'x' && dir !== 'y') fail(`${ww}: dir は x か y です`);
    if (len <= w) fail(`${ww}: length (全長) は width (幅) より大きくしてください`);
    const c = vec(p.at, 2, `${ww} の at`), m = box.ct || 0, hx = dir === 'x' ? len / 2 : w / 2, hy = dir === 'x' ? w / 2 : len / 2;
    if (c[0] - hx < m || c[0] + hx > box.size[0] - m || c[1] - hy < m || c[1] + hy > box.size[1] - m) fail(`${ww}: 長穴が box「${target}」(${box.size[0]} × ${box.size[1]}) からはみ出しています`);
    const sl = { w, len, dir, at: c, cx: c[0], cy: c[1], fit: sstr(p.fit), tol: sstr(p.tol) };
    box.holes.forEach((o) => { const [a, b] = slotSeg(sl); if (distSeg(o.at[0], o.at[1], a, b) < holeRim(o) + w / 2) fail(`${ww}: box「${target}」の穴と重なっています`); });
    box.slots.forEach((o) => { const [a, b] = slotSeg(o), [a2, b2] = slotSeg(sl); if (Math.min(distSeg(...a2, a, b), distSeg(...b2, a, b), distSeg(...a, a2, b2), distSeg(...b, a2, b2)) < (o.w + w) / 2) fail(`${ww}: box「${target}」の他の長穴と重なっています`); });
    box.slots.push(sl);
  });
  if (!boxes.size && !cyls.length) fail(`${label} に形状がありません`);
  return { boxes: [...boxes.values()], cyls };
}

const ROT = { 0: (x, y) => [x, y], 90: (x, y) => [-y, x], 180: (x, y) => [-x, -y], 270: (x, y) => [y, -x] };
/* 部品定義(components)と配置(assembly)を、ワールド座標の形状に展開する */
function parseAssembly(spec) {
  const comps = spec.components;
  if (!isObj(comps) || !Object.keys(comps).length) fail('components: は「部品キー: {title, material, parts}」の形式で書いてください');
  const defs = new Map();
  Object.keys(comps).forEach((key, i) => {
    const c = comps[key];
    if (!isObj(c)) fail(`components の「${key}」は {title, material, parts} の形式で書いてください`);
    if (!Array.isArray(c.parts)) fail(`components の「${key}」に parts: の一覧が必要です`);
    defs.set(key, { key, n: i + 1, title: sstr(c.title) || key, material: sstr(c.material), drawing_no: sstr(c.drawing_no), mech: parseParts(c.parts, `components.${key}.parts`) });
  });
  const insts = [], used = new Set();
  list(spec, 'assembly', true).forEach((it, i) => {
    const w = `assembly の ${i + 1} 番目`;
    if (!isObj(it)) fail(`${w}: {id: A1, part: plate, at: [x, y, z], rotate: 0} の形式で書いてください`);
    const part = String(it.part ?? '');
    if (!defs.has(part)) fail(`${w}: part「${part}」は components にありません (${[...defs.keys()].join(' / ')})`);
    const id = String(it.id ?? `${part}${i + 1}`);
    if (id.includes('/')) fail(`${w}: id に「/」は使えません`);
    if (used.has(id)) fail(`${w}: id「${id}」が重複しています`);
    used.add(id);
    const rotate = num(it.rotate, `${w} の rotate`, 0);
    if (!ROT[rotate]) fail(`${w}: rotate は 0 / 90 / 180 / 270 のいずれかです`);
    insts.push({ id, part, rotate, at: vec(it.at, 3, `${w} の at`, [0, 0, 0]) });
  });
  if (!insts.length) fail('assembly に配置する部品がありません');
  const boxes = [], cyls = [];
  insts.forEach((ins) => {
    const rot = ROT[ins.rotate], def = defs.get(ins.part);
    def.mech.boxes.forEach((b) => {
      const p0 = rot(b.at[0], b.at[1]), p1 = rot(b.at[0] + b.size[0], b.at[1] + b.size[1]);
      const mn = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1])];
      boxes.push({
        name: `${ins.id}/${b.name}`, inst: ins.id, tol: b.tol, finish: b.finish, cr: b.cr, ct: b.ct, cb: b.cb,
        size: [Math.abs(p1[0] - p0[0]), Math.abs(p1[1] - p0[1]), b.size[2]],
        at: [mn[0] + ins.at[0], mn[1] + ins.at[1], b.at[2] + ins.at[2]],
        holes: b.holes.map((h) => {
          const c = rot(b.at[0] + h.at[0], b.at[1] + h.at[1]);
          return { ...h, at: [c[0] - mn[0], c[1] - mn[1]], ...(h.tdir ? { tdir: rot(h.tdir[0], h.tdir[1]) } : {}) };
        }),
        slots: b.slots.map((sl) => {
          const c = rot(b.at[0] + sl.at[0], b.at[1] + sl.at[1]), dir = ins.rotate === 90 || ins.rotate === 270 ? (sl.dir === 'x' ? 'y' : 'x') : sl.dir;
          const at = [c[0] - mn[0], c[1] - mn[1]];
          return { ...sl, dir, at, cx: at[0], cy: at[1] };
        }),
      });
    });
    def.mech.cyls.forEach((c) => {
      const p = rot(c.at[0], c.at[1]);
      cyls.push({ name: `${ins.id}/${c.name}`, inst: ins.id, d: c.d, h: c.h, tol: c.tol, finish: c.finish, ct: c.ct, cb: c.cb, ft: c.ft, fb: c.fb, at: [p[0] + ins.at[0], p[1] + ins.at[1], c.at[2] + ins.at[2]] });
    });
  });
  return { boxes, cyls, assembly: { defs: [...defs.values()], insts } };
}
function parseMech(spec) {
  if (spec.components !== undefined || spec.assembly !== undefined) return parseAssembly(spec);
  return parseParts(list(spec, 'parts', true), 'parts');
}

function roundedRectLines(x0, y0, x1, y1, R, layer) {
  const L = [line([x0 + R, y0], [x1 - R, y0], layer), line([x1, y0 + R], [x1, y1 - R], layer), line([x1 - R, y1], [x0 + R, y1], layer), line([x0, y1 - R], [x0, y0 + R], layer)];
  [[x1 - R, y0 + R, -90, 0], [x1 - R, y1 - R, 0, 90], [x0 + R, y1 - R, 90, 180], [x0 + R, y0 + R, 180, 270]]
    .forEach(([cx, cy, a0, a1]) => L.push({ t: 'arc', c: [cx, cy], r: R, a0, a1, layer }));
  return L;
}
function slotOutline(sl, layer, toLines) {
  const [a, b] = slotSeg(sl), r = sl.w / 2, out = [];
  if (sl.dir === 'x') {
    out.push(line([a[0], a[1] - r], [b[0], b[1] - r], layer), line([a[0], a[1] + r], [b[0], b[1] + r], layer));
    out.push({ t: 'arc', c: b, r, a0: -90, a1: 90, layer }, { t: 'arc', c: a, r, a0: 90, a1: 270, layer });
  } else {
    out.push(line([a[0] - r, a[1]], [b[0] - r, b[1]], layer), line([a[0] + r, a[1]], [b[0] + r, b[1]], layer));
    out.push({ t: 'arc', c: b, r, a0: 0, a1: 180, layer }, { t: 'arc', c: a, r, a0: 180, a1: 360, layer });
  }
  return toLines ? toLines(out) : out;
}
// 楕円(斜め穴の上面のふち)を折れ線で近似した円弧列
function ellipseLines(cx, cy, a, b, rotDeg, layer, n = 48) {
  const rot = rotDeg * Math.PI / 180, out = [];
  const pt = (i) => { const t = i / n * 2 * Math.PI, x = a * Math.cos(t), y = b * Math.sin(t); return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]; };
  for (let i = 0; i < n; i++) out.push(line(pt(i), pt(i + 1), layer));
  return out;
}
const holeRadii = (h) => [...new Set([h.d / 2, h.cbD ? h.cbD / 2 : null, h.cskD ? h.cskD / 2 : null].filter((r) => r))];

function build2dMech(spec) {
  const m = parseMech(spec), prims = [];
  m.boxes.forEach((b) => {
    const x0 = b.at[0], y0 = b.at[1], x1 = x0 + b.size[0], y1 = y0 + b.size[1];
    prims.push(...(b.cr ? roundedRectLines(x0, y0, x1, y1, b.cr, 'OUTLINE') : rectLines(x0, y0, x1, y1, 'OUTLINE')));
    if (b.ct) prims.push(...rectLines(x0 + b.ct, y0 + b.ct, x1 - b.ct, y1 - b.ct, 'OUTLINE'));
    if (b.cb) prims.push(...rectLines(x0 + b.cb, y0 + b.cb, x1 - b.cb, y1 - b.cb, 'HIDDEN'));
    b.holes.forEach((h) => {
      const c = [x0 + h.at[0], y0 + h.at[1]];
      if (h.tilt) prims.push(...ellipseLines(c[0], c[1], h.d / 2 / tiltC(h), h.d / 2, h.tdir[0] ? 0 : 90, 'HOLE'));
      else holeRadii(h).forEach((r) => prims.push({ t: 'circle', c, r, layer: 'HOLE' }));
      if (h.thread) prims.push({ t: 'arc', c, r: h.thread.D / 2, a0: 0, a1: 270, layer: 'HOLE' });
    });
    b.slots.forEach((sl) => slotOutline({ ...sl, cx: x0 + sl.cx, cy: y0 + sl.cy }, 'HOLE').forEach((q) => prims.push(q)));
  });
  m.cyls.forEach((c) => {
    prims.push({ t: 'circle', c: [c.at[0], c.at[1]], r: c.d / 2, layer: 'OUTLINE' });
    if (c.ct) prims.push({ t: 'circle', c: [c.at[0], c.at[1]], r: c.d / 2 - c.ct, layer: 'OUTLINE' });
    if (c.cb) prims.push({ t: 'circle', c: [c.at[0], c.at[1]], r: c.d / 2 - c.cb, layer: 'HIDDEN' });
  });
  return { kind: '2d', prims, note: '上面図 (XY平面)' };
}

/* ---- 3D: 単純な形状は押し出し、座ぐり・面取り・角Rなどは CSG (JSCAD) で作る ---- */
const SEG = 64;
function geom3ToBuffer(g) {
  const pos = [], polys = [];
  jscadModeling.geometries.geom3.toPolygons(g).forEach((poly) => {
    const v = poly.vertices;
    polys.push(v.map((q) => [q[0], q[1], q[2]]));
    for (let i = 1; i < v.length - 1; i++) pos.push(...v[0], ...v[i], ...v[i + 1]);
  });
  const geo = new THREE.BufferGeometry();
  geo.userData.polys = polys;
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
const needsCSG = (b) => b.cr || b.ct || b.cb || b.slots.length || b.holes.some((h) => h.kind !== 'through' || h.depth != null || h.tilt);
function csgBox(b) {
  const { cuboid, cylinder, cylinderElliptic, roundedRectangle } = jscadModeling.primitives;
  const { subtract } = jscadModeling.booleans, { extrudeLinear } = jscadModeling.extrusions, { hull } = jscadModeling.hulls, { translate } = jscadModeling.transforms;
  const [sx, sy, sz] = b.size, z0 = b.at[2], z1 = z0 + sz, cx = b.at[0] + sx / 2, cy = b.at[1] + sy / 2;
  let body;
  if (b.cr) body = translate([0, 0, z0], extrudeLinear({ height: sz }, roundedRectangle({ size: [sx, sy], roundRadius: b.cr, segments: SEG, center: [cx, cy] })));
  else if (b.ct || b.cb) {
    const hm = sz - b.ct - b.cb, parts = [cuboid({ size: [sx, sy, hm], center: [cx, cy, z0 + b.cb + hm / 2] })];
    if (b.ct) parts.push(cuboid({ size: [sx - 2 * b.ct, sy - 2 * b.ct, 0.001], center: [cx, cy, z1 - 0.0005] }));
    if (b.cb) parts.push(cuboid({ size: [sx - 2 * b.cb, sy - 2 * b.cb, 0.001], center: [cx, cy, z0 + 0.0005] }));
    body = hull(...parts);
  } else body = cuboid({ size: [sx, sy, sz], center: [cx, cy, z0 + sz / 2] });
  const cuts = [];
  const { rotateY, rotateZ, translate: tr } = jscadModeling.transforms;
  b.slots.forEach((sl) => {
    const [a, c2] = slotSeg({ ...sl, cx: b.at[0] + sl.cx, cy: b.at[1] + sl.cy }), r = sl.w / 2, zm = (z0 + z1) / 2, H = sz + 2;
    const mid = [(a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2], D = sl.len - sl.w;
    cuts.push(cuboid({ size: sl.dir === 'x' ? [D, sl.w, H] : [sl.w, D, H], center: [mid[0], mid[1], zm] }));
    [a, c2].forEach((q) => cuts.push(cylinder({ radius: r, height: H, center: [q[0], q[1], zm], segments: SEG })));
  });
  b.holes.forEach((h) => {
    const hx = b.at[0] + h.at[0], hy = b.at[1] + h.at[1], rh = h.d / 2;
    if (h.tilt) { // 斜め穴: 傾けた円柱で貫通
      const th = h.tilt * Math.PI / 180, zm = (z0 + z1) / 2, L = (sz + 2 * rh + 4) / Math.cos(th), sh = (z1 - zm) * Math.tan(th);
      let cyl = cylinder({ radius: rh, height: L, center: [0, 0, 0], segments: SEG });
      cyl = rotateZ(Math.atan2(h.tdir[1], h.tdir[0]), rotateY(-th, cyl));
      cuts.push(tr([hx + h.tdir[0] * sh, hy + h.tdir[1] * sh, zm], cyl));
      return;
    }
    const { pts, through } = holeSteps(h, z1, z0);
    const zb = through ? z0 - 1 : pts[pts.length - 1].z;
    cuts.push(cylinder({ radius: rh, height: z1 + 1 - zb, center: [hx, hy, (z1 + 1 + zb) / 2], segments: SEG }));
    if (h.kind === 'counterbore') cuts.push(cylinder({ radius: h.cbD / 2, height: h.cbDepth + 1, center: [hx, hy, (z1 + 1 + z1 - h.cbDepth) / 2], segments: SEG }));
    if (h.kind === 'countersink') {
      const k = Math.tan(h.cskAngle * Math.PI / 360), dk = cskDepth(h), re = rh + (dk + 1) * k;
      cuts.push(cylinderElliptic({ height: dk + 1, center: [hx, hy, (z1 - dk + z1 + 1) / 2], startRadius: [rh, rh], endRadius: [re, re], segments: SEG }));
    }
  });
  return cuts.length ? subtract(body, ...cuts) : body;
}
// 円柱の半径の減り (端面の面取り・フィレットによる)。c は z0,z1,ct,cb,ft,fb を持つ
function cylInset(c, z) {
  if (c.ct && z > c.z1 - c.ct) return z - (c.z1 - c.ct);
  if (c.cb && z < c.z0 + c.cb) return c.z0 + c.cb - z;
  if (c.ft && z > c.z1 - c.ft) { const d = z - (c.z1 - c.ft); return c.ft - Math.sqrt(Math.max(c.ft * c.ft - d * d, 0)); }
  if (c.fb && z < c.z0 + c.fb) { const d = c.z0 + c.fb - z; return c.fb - Math.sqrt(Math.max(c.fb * c.fb - d * d, 0)); }
  return 0;
}
function csgCylRevolve(c) {
  const { geom2 } = jscadModeling.geometries, { extrudeRotate } = jscadModeling.extrusions, { translate } = jscadModeling.transforms;
  const r = c.d / 2, z0 = c.at[2], z1 = z0 + c.h, N = 16, pts = [[0, z0]];
  if (c.fb) for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * i / N; pts.push([r - c.fb + c.fb * Math.cos(a), z0 + c.fb + c.fb * Math.sin(a)]); }
  else if (c.cb) pts.push([r - c.cb, z0], [r, z0 + c.cb]); else pts.push([r, z0]);
  if (c.ft) for (let i = 0; i <= N; i++) { const a = (Math.PI / 2) * i / N; pts.push([r - c.ft + c.ft * Math.cos(a), z1 - c.ft + c.ft * Math.sin(a)]); }
  else if (c.ct) pts.push([r, z1 - c.ct], [r - c.ct, z1]); else pts.push([r, z1]);
  pts.push([0, z1]);
  return translate([c.at[0], c.at[1], 0], extrudeRotate({ segments: SEG }, geom2.fromPoints(pts)));
}
function csgCyl(c) {
  if (c.ft || c.fb) return csgCylRevolve(c);
  const { cylinder } = jscadModeling.primitives, { hull } = jscadModeling.hulls;
  const r = c.d / 2, z0 = c.at[2], z1 = z0 + c.h, hm = c.h - c.ct - c.cb;
  const parts = [cylinder({ radius: r, height: hm, center: [c.at[0], c.at[1], z0 + c.cb + hm / 2], segments: SEG })];
  if (c.ct) parts.push(cylinder({ radius: r - c.ct, height: 0.001, center: [c.at[0], c.at[1], z1 - 0.0005], segments: SEG }));
  if (c.cb) parts.push(cylinder({ radius: r - c.cb, height: 0.001, center: [c.at[0], c.at[1], z0 + 0.0005], segments: SEG }));
  return hull(...parts);
}

function build3dMech(spec) {
  const m = parseMech(spec), meshes = [];
  m.boxes.forEach((b) => {
    let geo, csg = false;
    if (needsCSG(b)) { geo = geom3ToBuffer(csgBox(b)); csg = true; }
    else if (b.holes.length) {
      const s = new THREE.Shape();
      s.moveTo(0, 0); s.lineTo(b.size[0], 0); s.lineTo(b.size[0], b.size[1]); s.lineTo(0, b.size[1]); s.lineTo(0, 0);
      b.holes.forEach((h) => {
        const p = new THREE.Path();
        p.absarc(h.at[0], h.at[1], h.d / 2, 0, Math.PI * 2, true);
        s.holes.push(p);
      });
      geo = new THREE.ExtrudeGeometry(s, { depth: b.size[2], bevelEnabled: false, curveSegments: 48 });
      geo.translate(b.at[0], b.at[1], b.at[2]);
    } else {
      geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
      geo.translate(b.at[0] + b.size[0] / 2, b.at[1] + b.size[1] / 2, b.at[2] + b.size[2] / 2);
    }
    meshes.push({ geo, color: 0x9fb0c3, name: b.name, csg });
  });
  m.cyls.forEach((c) => {
    let geo, csg = false;
    if (c.ct || c.cb || c.ft || c.fb) { geo = geom3ToBuffer(csgCyl(c)); csg = true; }
    else {
      geo = new THREE.CylinderGeometry(c.d / 2, c.d / 2, c.h, 64);
      geo.rotateX(Math.PI / 2);
      geo.translate(c.at[0], c.at[1], c.at[2] + c.h / 2);
    }
    meshes.push({ geo, color: 0x7d93ab, name: c.name, csg });
  });
  return { kind: '3d', meshes };
}

/* =====================================================================
 * 分野: 建築
 * ===================================================================== */
function parseArch(spec) {
  const T0 = pos(spec.thickness, 'thickness', 200);
  const H = pos(spec.height, 'height', 2400);
  const walls = [];
  list(spec, 'walls', true).forEach((it, i) => {
    const w = `walls の ${i + 1} 番目`;
    let v = it;
    if (isObj(v) && Object.keys(v).length === 1 && isObj(v.wall)) v = v.wall;
    if (Array.isArray(v)) {
      if (v.length < 2) fail(`${w}: 点は 2 つ以上必要です`);
      const pts = v.map((p, k) => vec(p, 2, `${w} の点 ${k + 1}`));
      for (let k = 0; k < pts.length - 1; k++) walls.push({ a: pts[k], b: pts[k + 1], t: T0 });
    } else if (isObj(v)) {
      walls.push({
        a: vec(v.from, 2, `${w} の from`), b: vec(v.to, 2, `${w} の to`),
        t: pos(v.thickness, `${w} の thickness`, T0),
      });
    } else {
      fail(`${w}: [[x,y],[x,y],...] または {from: [x,y], to: [x,y]} の形式で書いてください`);
    }
  });
  if (!walls.length) fail('walls に壁がありません');
  walls.forEach((w, i) => {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    w.L = Math.hypot(dx, dy);
    if (w.L < 1e-6) fail(`壁 ${i + 1}: 始点と終点が同じです`);
    w.d = [dx / w.L, dy / w.L];
    w.n = [-w.d[1], w.d[0]];
    w.ang = Math.atan2(dy, dx);
    w.open = [];
  });
  [['doors', 'door'], ['windows', 'window']].forEach(([key, kind]) => {
    list(spec, key, false).forEach((o, i) => {
      const w = `${key} の ${i + 1} 番目`;
      if (!isObj(o)) fail(`${w}: {wall: 1, position: 1000, width: 900} の形式で書いてください`);
      const wi = num(o.wall, `${w} の wall`);
      if (!Number.isInteger(wi) || wi < 1 || wi > walls.length) fail(`${w}: wall は 1〜${walls.length} の壁番号で指定してください`);
      const wall = walls[wi - 1];
      const u0 = num(o.position, `${w} の position`), width = pos(o.width, `${w} の width`);
      if (u0 < 0 || u0 + width > wall.L + 1e-6) fail(`${w}: 壁 ${wi} (長さ ${wall.L.toFixed(0)}) の範囲を超えています`);
      const op = { kind, u0, u1: u0 + width, width, key: `${kind}${i + 1}`, wallIdx: wi - 1 };
      if (kind === 'door') {
        op.height = Math.min(pos(o.height, `${w} の height`, 2000), H);
        op.hinge = String(o.hinge ?? 'start');
        op.swing = String(o.swing ?? 'left');
        if (!['start', 'end'].includes(op.hinge)) fail(`${w}: hinge は start か end です`);
        if (!['left', 'right'].includes(op.swing)) fail(`${w}: swing は left か right です`);
      } else {
        op.sill = num(o.sill, `${w} の sill`, 900);
        op.height = pos(o.height, `${w} の height`, 1200);
        if (op.sill < 0 || op.sill + op.height > H) fail(`${w}: sill + height が壁の高さ ${H} を超えています`);
      }
      wall.open.push(op);
    });
  });
  walls.forEach((w, i) => {
    w.open.sort((p, q) => p.u0 - q.u0);
    for (let k = 1; k < w.open.length; k++) {
      if (w.open[k].u0 < w.open[k - 1].u1) fail(`壁 ${i + 1}: 開口部どうしが重なっています`);
    }
    const e = w.t / 2; // 端部を厚みの半分だけ延ばして角を埋める
    w.solids = [];
    let cur = -e;
    w.open.forEach((op) => { if (op.u0 > cur) w.solids.push([cur, op.u0]); cur = op.u1; });
    if (cur < w.L + e) w.solids.push([cur, w.L + e]);
  });
  const rooms = list(spec, 'rooms', false).map((r, i) => {
    if (!isObj(r)) fail(`rooms の ${i + 1} 番目: {name: 居室, at: [x, y]} の形式で書いてください`);
    return { name: String(r.name ?? ''), at: vec(r.at, 2, `rooms の ${i + 1} 番目の at`) };
  });
  return { walls, rooms, H, floor: spec.floor === true, th: pos(spec.text_height, 'text_height', 250) };
}
const wp = (w, u, v) => [w.a[0] + w.d[0] * u + w.n[0] * v, w.a[1] + w.d[1] * u + w.n[1] * v];

function build2dArch(spec) {
  const m = parseArch(spec);
  return { kind: '2d', prims: archPlanPrims(m), note: '平面図 (単位は任意。mm を想定)' };
}
function archPlanPrims(m) {
  const prims = [];
  m.walls.forEach((w) => {
    const h = w.t / 2;
    w.solids.forEach(([u0, u1]) => {
      prims.push({ t: 'poly', pts: [wp(w, u0, -h), wp(w, u1, -h), wp(w, u1, h), wp(w, u0, h)], layer: 'WALL', fill: true });
    });
    w.open.forEach((op) => {
      if (op.kind === 'window') {
        [-h, 0, h].forEach((v) => prims.push(line(wp(w, op.u0, v), wp(w, op.u1, v), 'WINDOW')));
      } else {
        const sgn = op.swing === 'left' ? 1 : -1;
        const hu = op.hinge === 'start' ? op.u0 : op.u1;
        const dsg = op.hinge === 'start' ? 1 : -1;
        const H0 = wp(w, hu, 0);
        const dir = [w.d[0] * dsg, w.d[1] * dsg];
        const nv = [w.n[0] * sgn, w.n[1] * sgn];
        prims.push(line(H0, [H0[0] + nv[0] * op.width, H0[1] + nv[1] * op.width], 'DOOR'));
        const aD = Math.atan2(dir[1], dir[0]) * 180 / Math.PI, aN = Math.atan2(nv[1], nv[0]) * 180 / Math.PI;
        const ccw = dir[0] * nv[1] - dir[1] * nv[0] > 0;
        prims.push({ t: 'arc', c: H0, r: op.width, a0: ccw ? aD : aN, a1: ccw ? aN : aD, layer: 'DOOR' });
      }
    });
  });
  m.rooms.forEach((r) => prims.push({ t: 'text', p: r.at, h: m.th, s: r.name, layer: 'TEXT' }));
  return prims;
}

function build3dArch(spec) {
  const m = parseArch(spec), meshes = [];
  const piece = (w, u0, u1, z0, z1) => {
    if (u1 - u0 < 1e-6 || z1 - z0 < 1e-6) return;
    const name = `wall${m.walls.indexOf(w) + 1}`;
    const g = new THREE.BoxGeometry(u1 - u0, w.t, z1 - z0);
    g.translate((u0 + u1) / 2, 0, (z0 + z1) / 2);
    g.rotateZ(w.ang);
    g.translate(w.a[0], w.a[1], 0);
    meshes.push({ geo: g, color: 0xb6c2d0, name });
  };
  m.walls.forEach((w) => {
    w.solids.forEach(([u0, u1]) => piece(w, u0, u1, 0, m.H));
    w.open.forEach((op) => {
      if (op.kind === 'door') piece(w, op.u0, op.u1, op.height, m.H);
      else { piece(w, op.u0, op.u1, 0, op.sill); piece(w, op.u0, op.u1, op.sill + op.height, m.H); }
    });
  });
  if (m.floor) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    m.walls.forEach((w) => [w.a, w.b].forEach((p) => {
      x0 = Math.min(x0, p[0] - w.t / 2); x1 = Math.max(x1, p[0] + w.t / 2);
      y0 = Math.min(y0, p[1] - w.t / 2); y1 = Math.max(y1, p[1] + w.t / 2);
    }));
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, 100);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, -50);
    meshes.push({ geo: g, color: 0xdde6f0 });
  }
  return { kind: '3d', meshes };
}

/* =====================================================================
 * 分野: 電気回路
 * ===================================================================== */
const PINS = {
  resistor: { 1: -30, 2: 30 },
  capacitor: { 1: -30, 2: 30 },
  battery: { '+': -30, '-': 30, 1: -30, 2: 30 },
  led: { A: -30, K: 30, 1: -30, 2: 30 },
  switch: { 1: -30, 2: 30 },
  lamp: { 1: -30, 2: 30 },
};
function symbolPrims(type, cx, cy) {
  const P = [];
  const L = (x1, y1, x2, y2) => P.push(line([cx + x1, cy + y1], [cx + x2, cy + y2], 'SYMBOL'));
  const C = (x, y, r, fill) => P.push({ t: 'circle', c: [cx + x, cy + y], r, layer: 'SYMBOL', fill });
  switch (type) {
    case 'resistor':
      L(-30, 0, -15, 0); L(15, 0, 30, 0);
      L(-15, -6, 15, -6); L(15, -6, 15, 6); L(15, 6, -15, 6); L(-15, 6, -15, -6); break;
    case 'capacitor':
      L(-30, 0, -4, 0); L(4, 0, 30, 0); L(-4, -12, -4, 12); L(4, -12, 4, 12); break;
    case 'battery':
      L(-30, 0, -5, 0); L(5, 0, 30, 0); L(-5, -12, -5, 12); L(5, -7, 5, 7);
      P.push({ t: 'text', p: [cx - 16, cy + 6], h: 9, s: '+', layer: 'TEXT' }); break;
    case 'led':
      L(-30, 0, -8, 0); L(8, 0, 30, 0); L(-8, -9, -8, 9); L(-8, 9, 8, 0); L(8, 0, -8, -9); L(8, -9, 8, 9);
      L(-1, 11, 6, 18); L(3, 9, 10, 16); break;
    case 'switch':
      L(-30, 0, -12, 0); L(12, 0, 30, 0); L(-12, 0, 10, -12); C(-12, 0, 2); C(12, 0, 2); break;
    case 'lamp':
      L(-30, 0, -11, 0); L(11, 0, 30, 0); C(0, 0, 11); L(-8, -8, 8, 8); L(-8, 8, 8, -8); break;
  }
  return P;
}

function build2dElec(spec) {
  const parts = new Map();
  list(spec, 'parts', true).forEach((p, i) => {
    const w = `parts の ${i + 1} 番目`;
    if (!isObj(p)) fail(`${w}: {id: R1, type: resistor, value: 1k} の形式で書いてください`);
    const id = String(p.id ?? '');
    if (!id) fail(`${w}: id が必要です`);
    if (id.includes('.')) fail(`${w}: id に「.」は使えません`);
    if (parts.has(id)) fail(`${w}: id「${id}」が重複しています`);
    const type = String(p.type ?? '');
    if (!PINS[type]) fail(`${w} (${id}): type「${type}」は未対応です (使えるのは ${Object.keys(PINS).join(' / ')})`);
    const at = vec(p.at, 2, `${w} の at`, [i * 120, 0]);
    parts.set(id, { id, type, value: p.value === undefined ? '' : String(p.value), x: at[0], y: at[1] });
  });
  if (!parts.size) fail('parts に部品がありません');
  const TH = pos(spec.text_height, 'text_height', 10);
  const prims = [];
  parts.forEach((p) => {
    prims.push(...symbolPrims(p.type, p.x, p.y));
    prims.push({ t: 'text', p: [p.x, p.y + 24], h: TH, s: p.id, layer: 'TEXT' });
    if (p.value) prims.push({ t: 'text', p: [p.x, p.y - 24 - TH], h: TH, s: p.value, layer: 'TEXT' });
  });
  const pinPos = (ref, where) => {
    const s = String(ref), k = s.indexOf('.');
    if (k < 1) fail(`${where}: 「部品ID.ピン名」の形式で書いてください (例: R1.1) 現在: ${s}`);
    const p = parts.get(s.slice(0, k));
    if (!p) fail(`${where}: 部品「${s.slice(0, k)}」がありません`);
    const pin = s.slice(k + 1);
    if (!(pin in PINS[p.type])) fail(`${where}: ${p.type} のピンは ${Object.keys(PINS[p.type]).join(' / ')} です (指定: ${pin})`);
    return [p.x + PINS[p.type][pin], p.y];
  };
  const ys = [...parts.values()].map((p) => p.y);
  const maxY = Math.max(...ys), minY = Math.min(...ys);
  let top = 0, bottom = 0, toggle = 0;
  const pinCount = new Map();
  const blocked = (ax, bx, y) => [...parts.values()].some((p) =>
    Math.abs(p.y - y) <= 14 && Math.min(ax, bx) < p.x + 22 && Math.max(ax, bx) > p.x - 22);
  list(spec, 'wires', false).forEach((wr, i) => {
    const w = `wires の ${i + 1} 番目`;
    let a, b, route = 'auto';
    if (Array.isArray(wr) && wr.length === 2) { a = wr[0]; b = wr[1]; }
    else if (isObj(wr)) { a = wr.from; b = wr.to; route = String(wr.route ?? 'auto'); }
    else fail(`${w}: [R1.1, V1.+] または {from: R1.1, to: V1.+} の形式で書いてください`);
    if (!['auto', 'top', 'bottom', 'direct'].includes(route)) fail(`${w}: route は top / bottom / direct のいずれかです`);
    const A = pinPos(a, w), B = pinPos(b, w);
    [String(a), String(b)].forEach((k) => pinCount.set(k, (pinCount.get(k) || 0) + 1));
    if (route === 'auto') {
      route = (A[1] === B[1] && !blocked(A[0], B[0], A[1])) ? 'direct' : (toggle++ % 2 === 0 ? 'top' : 'bottom');
    }
    let pts;
    if (route === 'direct') pts = [A, B];
    else {
      const yr = route === 'top' ? maxY + 50 + 14 * top++ : minY - 50 - 14 * bottom++;
      pts = [A, [A[0], yr], [B[0], yr], B];
    }
    for (let k = 0; k < pts.length - 1; k++) prims.push(line(pts[k], pts[k + 1], 'WIRE'));
  });
  pinCount.forEach((c, ref) => {
    if (c >= 2) prims.push({ t: 'circle', c: pinPos(ref, 'junction'), r: 2.5, layer: 'WIRE', fill: true });
  });
  return { kind: '2d', prims, note: '回路図' };
}

/* =====================================================================
 * ビルド振り分け
 * ===================================================================== */
const DOMAINS = {
  mechanical: { label: '機械部品', b2: build2dMech, b3: build3dMech },
  architecture: { label: '建築', b2: build2dArch, b3: build3dArch },
  electrical: { label: '電気回路', b2: build2dElec, b3: null },
};
function buildScene(spec) {
  if (!isObj(spec)) fail('入力が空か、「キー: 値」の形式になっていません');
  const domain = String(spec.domain ?? '');
  if (!DOMAINS[domain]) fail(`domain を指定してください (${Object.keys(DOMAINS).join(' / ')})`);
  const mode = String(spec.mode ?? '2d').toLowerCase();
  if (mode !== '2d' && mode !== '3d') fail('mode は 2d か 3d で指定してください');
  const d = DOMAINS[domain];
  if (mode === '3d' && !d.b3) fail(`${d.label}は 2D のみ対応しています。mode: 2d にしてください`);
  const s = mode === '2d' ? d.b2(spec) : d.b3(spec);
  s.domain = domain; s.mode = mode;
  return s;
}

/* =====================================================================
 * 出力: DXF / SVG / STL
 * ===================================================================== */
function dxfStr(s) {
  return String(s).replace(/[^\x20-\x7e]/g, (c) => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
}
function toDXF(prims) {
  const out = [];
  const g = (code, val) => out.push(String(code), String(val));
  const f = (v) => (Math.round(v * 1e6) / 1e6).toString();
  prims = prims.filter((p) => !p.view);
  const used = [...new Set(prims.map((p) => p.layer))];
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0.0);
  g(0, 'LTYPE'); g(2, 'HIDDEN'); g(70, 0); g(3, 'Hidden __ __ __'); g(72, 65); g(73, 2); g(40, 6.0); g(49, 3.0); g(49, -3.0);
  g(0, 'LTYPE'); g(2, 'CENTER'); g(70, 0); g(3, 'Center ____ _ ____ _'); g(72, 65); g(73, 4); g(40, 28.0); g(49, 20.0); g(49, -2.5); g(49, 2.0); g(49, -2.5);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, used.length);
  used.forEach((l) => { g(0, 'LAYER'); g(2, l); g(70, 0); g(62, LAYERS[l].aci); g(6, LAYERS[l].lt || 'CONTINUOUS'); });
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const seg = (a, b, layer) => {
    g(0, 'LINE'); g(8, layer); g(10, f(a[0])); g(20, f(a[1])); g(30, 0); g(11, f(b[0])); g(21, f(b[1])); g(31, 0);
  };
  prims.forEach((p) => {
    if (p.t === 'line') seg(p.a, p.b, p.layer);
    else if (p.t === 'poly') p.pts.forEach((q, i) => seg(q, p.pts[(i + 1) % p.pts.length], p.layer));
    else if (p.t === 'circle') { g(0, 'CIRCLE'); g(8, p.layer); g(10, f(p.c[0])); g(20, f(p.c[1])); g(30, 0); g(40, f(p.r)); }
    else if (p.t === 'arc') { g(0, 'ARC'); g(8, p.layer); g(10, f(p.c[0])); g(20, f(p.c[1])); g(30, 0); g(40, f(p.r)); g(50, f(((p.a0 % 360) + 360) % 360)); g(51, f(((p.a1 % 360) + 360) % 360)); }
    else if (p.t === 'text') {
      g(0, 'TEXT'); g(8, p.layer); g(10, f(p.p[0])); g(20, f(p.p[1])); g(30, 0); g(40, f(p.h));
      if (p.rot) g(50, f(p.rot));
      g(1, dxfStr(p.s));
      if (p.anchor !== 'start') { g(72, p.anchor === 'end' ? 2 : 1); g(11, f(p.p[0])); g(21, f(p.p[1])); g(31, 0); }
    }
  });
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function arcPts(p) {
  let a0 = p.a0, a1 = p.a1;
  while (a1 < a0) a1 += 360;
  const n = Math.max(8, Math.ceil((a1 - a0) / 5)), r = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
    r.push([p.c[0] + p.r * Math.cos(a), p.c[1] + p.r * Math.sin(a)]);
  }
  return r;
}
function bounds2d(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  prims.forEach((p) => {
    if (p.t === 'line') { add(...p.a); add(...p.b); }
    else if (p.t === 'poly') p.pts.forEach((q) => add(...q));
    else if (p.t === 'circle') { add(p.c[0] - p.r, p.c[1] - p.r); add(p.c[0] + p.r, p.c[1] + p.r); }
    else if (p.t === 'arc') arcPts(p).forEach((q) => add(...q));
    else if (p.t === 'text') {
      const w = [...p.s].reduce((s, ch) => s + (ch.charCodeAt(0) > 255 ? 1 : 0.6), 0) * p.h;
      const a = p.anchor === 'start' ? 0 : p.anchor === 'end' ? w : w / 2;
      if (p.rot) { add(p.p[0] - p.h, p.p[1] - a); add(p.p[0], p.p[1] - a + w); }
      else { add(p.p[0] - a, p.p[1]); add(p.p[0] - a + w, p.p[1] + p.h); }
    }
  });
  return isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 100, y1: 100 };
}
function svgBody(prims) {
  const P = (q) => `${+q[0].toFixed(3)},${+(-q[1]).toFixed(3)}`;
  const ns = 'vector-effect="non-scaling-stroke"';
  return prims.map((p) => {
    const L = LAYERS[p.layer], c = L.color, w = L.w || 1.6;
    const dash = L.dash ? ` stroke-dasharray="${L.dash}"` : '';
    if (p.t === 'line') return `<line x1="${+p.a[0].toFixed(3)}" y1="${+(-p.a[1]).toFixed(3)}" x2="${+p.b[0].toFixed(3)}" y2="${+(-p.b[1]).toFixed(3)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"${dash} ${ns}/>`;
    if (p.t === 'poly') {
      const fill = p.view ? '#ffffff' : (p.fill ? c : 'none');
      return `<polygon points="${p.pts.map(P).join(' ')}" fill="${fill}" stroke="${p.view ? 'none' : c}" stroke-width="1.2" stroke-linejoin="round" ${ns}/>`;
    }
    if (p.t === 'circle') return `<circle cx="${+p.c[0].toFixed(3)}" cy="${+(-p.c[1]).toFixed(3)}" r="${+p.r.toFixed(3)}" fill="${p.fill ? c : 'none'}" stroke="${c}" stroke-width="${w}"${dash} ${ns}/>`;
    if (p.t === 'arc') return `<polyline points="${arcPts(p).map(P).join(' ')}" fill="none" stroke="${c}" stroke-width="${w}" ${ns}/>`;
    const x = +p.p[0].toFixed(3), y = +(-p.p[1]).toFixed(3);
    const tr = p.rot ? ` transform="rotate(${-p.rot} ${x} ${y})"` : '';
    return `<text x="${x}" y="${y}" font-size="${p.h}" text-anchor="${p.anchor === 'start' ? 'start' : p.anchor === 'end' ? 'end' : 'middle'}" fill="${c}"${tr} font-family="system-ui, 'Hiragino Sans', 'Noto Sans JP', sans-serif">${esc(p.s)}</text>`;
  }).join('');
}
function toSVGFile(prims) {
  const b = bounds2d(prims), m = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.05 + 1;
  const w = b.x1 - b.x0 + 2 * m, h = b.y1 - b.y0 + 2 * m;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x0 - m} ${-b.y1 - m} ${w} ${h}" width="${Math.min(1200, w)}" height="${Math.min(1200, w) * h / w}">\n<rect x="${b.x0 - m}" y="${-b.y1 - m}" width="${w}" height="${h}" fill="#ffffff"/>\n${svgBody(prims.filter((p) => !p.view))}\n</svg>\n`;
}
// CSG の結果は隣り合う面の辺が揃わない(T字接合)ことがある。各多角形の辺上にある他の頂点を挿入し、
// 多角形の重心から扇形に三角形化する (面積ゼロの三角形ができず、辺は必ず隣と一致する)
function conformPolys(polys, tol = 1e-4) {
  const snap = (v) => Math.round(v / tol) * tol;
  const P = polys.map((poly) => poly.map((p) => p.map(snap)));
  const same = (p, q) => Math.abs(p[0] - q[0]) < tol / 2 && Math.abs(p[1] - q[1]) < tol / 2 && Math.abs(p[2] - q[2]) < tol / 2;
  const verts = [], seen = new Set();
  P.forEach((poly) => poly.forEach((p) => { const k = p.map((v) => Math.round(v / tol)).join(','); if (!seen.has(k)) { seen.add(k); verts.push(p); } }));
  const out = [];
  P.forEach((poly) => {
    const ring = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      ring.push(a);
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      if (L2 < 1e-12) return;
      const ins = [];
      for (const p of verts) {
        if (same(p, a) || same(p, b)) continue;
        const s0 = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L2;
        if (s0 <= 1e-6 || s0 >= 1 - 1e-6) continue;
        const dx = p[0] - (a[0] + ab[0] * s0), dy = p[1] - (a[1] + ab[1] * s0), dz = p[2] - (a[2] + ab[2] * s0);
        if (dx * dx + dy * dy + dz * dz < (tol * 2) * (tol * 2)) ins.push([s0, p]);
      }
      ins.sort((x, y) => x[0] - y[0]).forEach(([, p]) => ring.push(p));
    });
    if (ring.length === 3) { out.push(ring); return; }
    const C = [0, 1, 2].map((k) => ring.reduce((t, p) => t + p[k], 0) / ring.length);
    ring.forEach((p, i) => out.push([C, p, ring[(i + 1) % ring.length]]));
  });
  return out;
}
function toSTL(meshes) {
  const out = ['solid cad_text'];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const v = (p) => `vertex ${p.x} ${p.y} ${p.z}`;
  meshes.forEach(({ geo, csg }) => {
    const g = geo.index ? geo.toNonIndexed() : geo, pa = g.attributes.position;
    let tris = [];
    if (csg && geo.userData.polys) tris = conformPolys(geo.userData.polys);
    else for (let i = 0; i + 2 < pa.count; i += 3) tris.push([[pa.getX(i), pa.getY(i), pa.getZ(i)], [pa.getX(i + 1), pa.getY(i + 1), pa.getZ(i + 1)], [pa.getX(i + 2), pa.getY(i + 2), pa.getZ(i + 2)]]);
    tris.forEach((t) => {
      a.set(...t[0]); b.set(...t[1]); c.set(...t[2]);
      n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
      out.push(`facet normal ${n.x} ${n.y} ${n.z}`, ' outer loop', '  ' + v(a), '  ' + v(b), '  ' + v(c), ' endloop', 'endfacet');
    });
  });
  out.push('endsolid cad_text');
  return out.join('\n') + '\n';
}
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =====================================================================
 * 2D ビューア (SVG, ホイールで拡大縮小 / ドラッグで移動)
 * ===================================================================== */
const svg = document.getElementById('svg2d');
let vb = { x: 0, y: 0, w: 100, h: 100 };
const applyVB = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
function fit2d(prims) {
  const b = bounds2d(prims), m = Math.max(b.x1 - b.x0, b.y1 - b.y0, 1) * 0.08;
  vb = { x: b.x0 - m, y: -b.y1 - m, w: b.x1 - b.x0 + 2 * m, h: b.y1 - b.y0 + 2 * m };
  applyVB();
}
function ptr2model(e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = ptr2model(e), k = Math.exp(e.deltaY * 0.0015);
  vb = { x: p.x + (vb.x - p.x) * k, y: p.y + (vb.y - p.y) * k, w: vb.w * k, h: vb.h * k };
  applyVB();
}, { passive: false });
let drag2d = null;
svg.addEventListener('pointerdown', (e) => { drag2d = { x: e.clientX, y: e.clientY }; svg.setPointerCapture(e.pointerId); svg.classList.add('grab'); });
svg.addEventListener('pointermove', (e) => {
  if (!drag2d) return;
  const s = svg.getScreenCTM().a;
  vb.x -= (e.clientX - drag2d.x) / s; vb.y -= (e.clientY - drag2d.y) / s;
  drag2d = { x: e.clientX, y: e.clientY }; applyVB();
});
const endDrag = () => { drag2d = null; svg.classList.remove('grab'); };
svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);
svg.addEventListener('dblclick', () => { if (cur && cur.kind === '2d') fit2d(cur.prims); });

/* =====================================================================
 * 3D ビューア (three.js, 左ドラッグ回転 / 右ドラッグ・Shift+ドラッグ移動 / ホイール拡大縮小)
 * ===================================================================== */
const canvas = document.getElementById('canvas3d');
const V = { r: null, scene: null, cam: null, grp: null, az: -0.9, el: 0.5, dist: 100, tgt: null, ok: false };
function init3d() {
  try {
    V.r = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) { return false; }
  V.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  V.r.setClearColor(0xf8fafc);
  V.scene = new THREE.Scene();
  V.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.8); d1.position.set(1, -1.5, 2); V.scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.35); d2.position.set(-1.5, 1, 0.6); V.scene.add(d2);
  V.cam = new THREE.PerspectiveCamera(40, 1, 1, 1e6); V.cam.up.set(0, 0, 1);
  V.grp = new THREE.Group(); V.scene.add(V.grp);
  V.tgt = new THREE.Vector3();
  V.ok = true;
  return true;
}
let raf = 0;
function render3d() {
  if (!V.ok || raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const ce = Math.cos(V.el);
    V.cam.position.set(V.tgt.x + V.dist * ce * Math.cos(V.az), V.tgt.y + V.dist * ce * Math.sin(V.az), V.tgt.z + V.dist * Math.sin(V.el));
    V.cam.near = V.dist * 0.01; V.cam.far = V.dist * 200; V.cam.updateProjectionMatrix();
    V.cam.lookAt(V.tgt);
    V.r.render(V.scene, V.cam);
  });
}
function resize3d() {
  if (!V.ok) return;
  const box = canvas.parentElement.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return;
  V.r.setSize(box.width, box.height, false);
  V.cam.aspect = box.width / box.height; V.cam.updateProjectionMatrix();
  render3d();
}
function disposeGroup() {
  while (V.grp.children.length) {
    const o = V.grp.children.pop();
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  }
}
let bbox3 = null;
function show3d(meshes, fit, hot) {
  disposeGroup();
  const box = new THREE.Box3();
  meshes.forEach(({ geo, color, name }) => {
    const isHot = hot && name && hot.has(name);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: isHot ? 0xef4444 : color, roughness: 0.75, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    V.grp.add(m);
    V.grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x1e293b })));
    geo.computeBoundingBox(); box.union(geo.boundingBox);
  });
  bbox3 = box;
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1);
  const grid = new THREE.GridHelper(Math.ceil(span * 3 / 100) * 100 || 100, 30, 0xcbd5e1, 0xe2e8f0);
  grid.rotateX(Math.PI / 2); grid.position.set(ctr.x, ctr.y, box.min.z - span * 0.0005);
  V.grp.add(grid);
  if (fit) { V.tgt.copy(ctr); V.dist = span * 2.4; V.az = -0.9; V.el = 0.5; }
  render3d();
}
let drag3d = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  drag3d = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
  canvas.setPointerCapture(e.pointerId); canvas.classList.add('grab');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag3d || !V.ok) return;
  const dx = e.clientX - drag3d.x, dy = e.clientY - drag3d.y;
  drag3d.x = e.clientX; drag3d.y = e.clientY;
  if (drag3d.pan) {
    const k = V.dist * 0.0016, fwd = new THREE.Vector3().subVectors(V.tgt, V.cam.position).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, V.cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    V.tgt.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  } else {
    V.az -= dx * 0.008;
    V.el = Math.max(-1.5, Math.min(1.5, V.el + dy * 0.008));
  }
  render3d();
});
const end3 = () => { drag3d = null; canvas.classList.remove('grab'); };
canvas.addEventListener('pointerup', end3); canvas.addEventListener('pointercancel', end3);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); V.dist *= Math.exp(e.deltaY * 0.0012); render3d(); }, { passive: false });
canvas.addEventListener('dblclick', () => { if (cur && cur.kind === '3d') show3d(cur.meshes, true); });

