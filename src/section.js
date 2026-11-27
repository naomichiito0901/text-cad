/* =====================================================================
 * 断面図 (A-A 断面)  切断面の形状を 2D ブーリアン演算で求め、ハッチングを引く
 *   plane: y → 面 y=at で切り、手前(-y側)から見る (横軸 x)
 *   plane: x → 面 x=at で切り、右(+x側)から見る  (横軸 y)
 * ===================================================================== */
const ptsArea = (p) => p.reduce((a, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return a + (x * y2 - x2 * y) / 2; }, 0);
const ccwPts = (p) => (ptsArea(p) < 0 ? p.slice().reverse() : p);
const dedupePts = (p) => p.filter((q, i) => { const r = p[(i + 1) % p.length]; return Math.hypot(q[0] - r[0], q[1] - r[1]) > 1e-9; });

function parseSections(spec, solids) {
  const v = spec.sections;
  if (v === undefined || v === null || v === false || v === 'none') return [];
  let list;
  if (v === 'auto') {
    const holes = solids.flatMap((o) => o.holes.map((h) => h));
    const pick = holes.find((h) => h.kind !== 'through' || h.depth != null) || holes[0];
    if (!pick) return [];
    list = [{ plane: 'y', at: pick.y }];
  } else if (Array.isArray(v)) list = v;
  else fail('sections: は auto か、{plane: y, at: 30} の一覧で書いてください');
  if (list.length > 6) fail('sections は 6 個までです');
  return list.map((it, i) => {
    const w = `sections の ${i + 1} 番目`;
    if (!isObj(it)) fail(`${w}: {plane: y, at: 30} の形式で書いてください`);
    const plane = String(it.plane ?? 'y').toLowerCase();
    if (plane !== 'x' && plane !== 'y') fail(`${w}: plane は x か y です`);
    const at = num(it.at, `${w} の at`);
    const lo = Math.min(...solids.map((o) => o[`${plane}0`])), hi = Math.max(...solids.map((o) => o[`${plane}1`]));
    if (!(at > lo + eps && at < hi - eps)) fail(`${w}: at=${nf(at)} は形状の範囲 (${plane}: ${nf(lo)} 〜 ${nf(hi)}) の内側で指定してください`);
    return { plane, at, label: String(it.label ?? String.fromCharCode(65 + i)) };
  });
}

/* 長穴の切断線上の区間 [u0,u1] */
function slotChord(sl, plane, c) {
  const r = sl.w / 2, D = sl.len - sl.w, onU = plane === 'y' ? 'x' : 'y';
  const cu = plane === 'y' ? sl.cx : sl.cy, co = plane === 'y' ? sl.cy : sl.cx, d = Math.abs(c - co);
  if (d >= r + (sl.dir === onU ? 0 : D / 2) - 1e-9) return null;
  if (sl.dir === onU) { const sw = Math.sqrt(Math.max(r * r - d * d, 0)); return [cu - D / 2 - sw, cu + D / 2 + sw]; } // 切断面が長穴の長手方向と平行
  const hw = d <= D / 2 ? r : Math.sqrt(Math.max(r * r - (d - D / 2) ** 2, 0)); // 長手方向と直交
  return [cu - hw, cu + hw];
}
/* 斜め穴の切断面 (高さごとに区間を求めて多角形にする) */
function tiltedVoid(h, s, plane, c) {
  const [dx, dy] = h.tdir, r = h.d / 2, cc = tiltC(h) ** 2, L = [], R = [];
  const N = 24, za = s.z0 - 1, zb = s.z1 + 1;
  for (let i = 0; i <= N; i++) {
    const z = za + (zb - za) * i / N, [px, py] = axisAt(h, s.z1, z);
    let center, A, C;
    if (plane === 'y') { const Y = c - py; center = px; A = cc * dx * dx + dy * dy; C = (cc * dy * dy + dx * dx) * Y * Y - r * r; }
    else { const X = c - px; center = py; A = cc * dy * dy + dx * dx; C = (cc * dx * dx + dy * dy) * X * X - r * r; }
    if (-C / A <= 0) continue;
    const half = Math.sqrt(-C / A);
    L.push([center - half, z]); R.push([center + half, z]);
  }
  return L.length >= 2 ? [...L, ...R.reverse()] : null;
}

/* 1つの立体の切断面 (geom2)。切らなければ null */
function solidSectionRegion(s, plane, c) {
  const { geom2 } = jscadModeling.geometries, { subtract } = jscadModeling.booleans;
  const U = plane === 'y' ? 'x' : 'y', O = plane === 'y' ? 'y' : 'x';
  const u0 = s[`${U}0`], u1 = s[`${U}1`], o0 = s[`${O}0`], o1 = s[`${O}1`];
  if (!(c > o0 + eps && c < o1 - eps)) return null;
  let base;
  if (s.kind === 'box') {
    const d = Math.min(c - o0, o1 - c);
    const ci = s.cr && d < s.cr ? s.cr - Math.sqrt(s.cr * s.cr - (s.cr - d) ** 2) : 0;
    const a = u0 + ci, b = u1 - ci, cb = s.cb, ct = s.ct;
    base = dedupePts([[a + cb, s.z0], [b - cb, s.z0], [b, s.z0 + cb], [b, s.z1 - ct], [b - ct, s.z1], [a + ct, s.z1], [a, s.z1 - ct], [a, s.z0 + cb]]);
  } else {
    const cu = (u0 + u1) / 2, dc = c - (o0 + o1) / 2, r = s.r;
    const hw = (z) => { const rr = r - cylInset(s, z); return rr * rr > dc * dc ? Math.sqrt(rr * rr - dc * dc) : 0; };
    const bb = s.cb || s.fb, tt = s.ct || s.ft, zs = [s.z0];
    if (bb) for (let i = 1; i <= 16; i++) zs.push(s.z0 + bb * i / 16);
    if (tt) { if (s.z1 - tt > zs[zs.length - 1] + 1e-9) zs.push(s.z1 - tt); for (let i = 1; i <= 16; i++) zs.push(s.z1 - tt + tt * i / 16); } else zs.push(s.z1);
    const L = zs.map((z) => [cu - hw(z), z]), R = zs.map((z) => [cu + hw(z), z]).reverse();
    base = dedupePts([...L, ...R]);
  }
  const voids = [];
  (s.slots || []).forEach((sl) => { const ch = slotChord(sl, plane, c); if (ch) voids.push([[ch[0], s.z0 - 1], [ch[1], s.z0 - 1], [ch[1], s.z1 + 1], [ch[0], s.z1 + 1]]); });
  (s.holes || []).forEach((h) => {
    if (h.tilt) { const poly = tiltedVoid(h, s, plane, c); if (poly) voids.push(poly); return; }
    const ho = plane === 'y' ? h.y : h.x, hu = plane === 'y' ? h.x : h.y, dy = Math.abs(c - ho);
    if (dy >= holeRim(h) - 1e-9) return;
    const { pts, through } = holeSteps(h, s.z1, s.z0);
    const w = (r) => Math.sqrt(Math.max(r * r - dy * dy, 0));
    const left = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(a.z - b.z) < eps) left.push([hu - w(a.r), a.z], [hu - w(b.r), b.z]);
      else { const n = Math.abs(a.r - b.r) < 1e-9 ? 1 : 16; for (let k = i === 0 ? 0 : 1; k <= n; k++) { const t = k / n; left.push([hu - w(a.r + (b.r - a.r) * t), a.z + (b.z - a.z) * t]); } }
    }
    const right = left.map(([x, z]) => [2 * hu - x, z]);
    const poly = [[left[0][0], s.z1 + 1], ...left];
    if (through) poly.push([left[left.length - 1][0], s.z0 - 1], [right[right.length - 1][0], s.z0 - 1]);
    poly.push(...right.slice().reverse(), [right[0][0], s.z1 + 1]);
    voids.push(poly);
  });
  const region = geom2.fromPoints(ccwPts(base));
  return voids.length ? subtract(region, ...voids.map((p) => geom2.fromPoints(ccwPts(dedupePts(p))))) : region;
}

/* 切断面を部品(インスタンス)ごとにまとめる */
function sectionGroups(S, plane, c) {
  const { union } = jscadModeling.booleans, groups = new Map();
  S.forEach((o) => {
    const reg = solidSectionRegion(o, plane, c);
    if (!reg) return;
    const k = o.inst !== undefined ? o.inst : '_';
    if (!groups.has(k)) groups.set(k, { key: k, regions: [], solids: [] });
    groups.get(k).regions.push(reg); groups.get(k).solids.push(o);
  });
  return [...groups.values()].map((g) => ({ ...g, region: g.regions.length > 1 ? union(...g.regions) : g.regions[0] }));
}

const collinearReduce = (loop) => loop.filter((p, i) => {
  const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
  return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-7;
});

/* ハッチング: 角度 ang(度) の斜線を、輪郭(偶奇則)の内側だけ引く */
function hatchSegments(loops, ang, spacing) {
  const a = ang * Math.PI / 180, d = [Math.cos(a), Math.sin(a)], n = [-Math.sin(a), Math.cos(a)];
  const all = loops.flat(), cs = all.map((p) => p[0] * n[0] + p[1] * n[1]);
  const out = [];
  for (let c = Math.ceil(Math.min(...cs) / spacing) * spacing + 0.0137; c < Math.max(...cs); c += spacing) {
    const ts = [];
    loops.forEach((lp) => lp.forEach((p, i) => {
      const q = lp[(i + 1) % lp.length], cp = p[0] * n[0] + p[1] * n[1] - c, cq = q[0] * n[0] + q[1] * n[1] - c;
      if ((cp > 0) !== (cq > 0)) { const t = cp / (cp - cq), x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t; ts.push(x * d[0] + y * d[1]); }
    }));
    ts.sort((p, q) => p - q);
    for (let i = 0; i + 1 < ts.length; i += 2) out.push([[c * n[0] + ts[i] * d[0], c * n[1] + ts[i] * d[1]], [c * n[0] + ts[i + 1] * d[0], c * n[1] + ts[i + 1] * d[1]]]);
  }
  return out;
}

/* 断面図の図面 (1枚)。 data は sectionFor() の結果 (計算エンジンが求めた、部品ごとの断面の輪郭)。
   まだ求まっていない (pending) / 求められない (unavailable) ときは、その旨を書いた図面を返す */
function buildSectionDrawing(S, proj, revRows, sec, asm, data) {
  const sh = newSheet(proj), { prims, fl, fr, fb, ft, TBH } = sh;
  const E = archEmit(prims), auto = proj.dimensions === 'auto';
  if (data.state !== 'done') {
    const L = sec.label, pj = { ...proj, title: `${proj.title} 断面図 ${L}-${L}`, drawing_no: `${proj.drawing_no}-S${L}` };
    E.T(data.state === 'pending' ? '断面を計算中です (計算エンジンの読み込みが終わるまでお待ちください)' : '計算エンジンが使えないため、断面図を作れません (ページを読み込み直してください)', (fl + fr) / 2, (fb + ft) / 2, 5, { anchor: 'middle' });
    sheetDecor(prims, { proj: pj, revRows, scaleStr: scaleText(1), asm, labels: { material: '材質', kind: ['図の種類', '断面図'] } });
    return { prims, scale: 1, fits: true, need: [], have: [], paper: proj.paper, roughness: [], bbox: { W: 0, D: 0, H: 0 }, title: pj.title, drawing_no: pj.drawing_no, state: data.state };
  }
  const need = new Set([`sec:${sec.label}:w`, `sec:${sec.label}:h`]), have = new Set();
  const groups = data.groups;
  const loopsOf = groups.map((g) => g.loops);
  const flat = loopsOf.flat().flat();
  const u0 = Math.min(...flat.map((p) => p[0])), u1 = Math.max(...flat.map((p) => p[0]));
  const v0 = Math.min(...flat.map((p) => p[1])), v1 = Math.max(...flat.map((p) => p[1]));
  const Wb = u1 - u0, Hb = v1 - v0;
  const cuts = []; // 中心を通る穴
  S.forEach((o) => o.holes.forEach((h, i) => {
    const ho = sec.plane === 'y' ? h.y : h.x;
    if (Math.abs(ho - sec.at) < 0.05) { cuts.push({ o, h, key: `${o.name}.hole${i + 1}`, hu: sec.plane === 'y' ? h.x : h.y }); need.add(`sec:${sec.label}:${o.name}.hole${i + 1}`); }
  }));
  const nRev = Math.min(revRows.length, 4), topStrip = 14 + (nRev ? 6 * (nRev + 1) : 0);
  const mL = auto ? 22 : 8, mB = auto ? 32 : 14, mT = 12 + (cuts.length ? 18 : 0), mR = 14;
  const rx0 = fl + 6 + mL, rx1 = fr - 6 - mR, ry0 = fb + TBH + 6 + mB, ry1 = ft - topStrip - mT;
  const { s, fits } = (() => {
    const fit = (sc) => Wb * sc <= rx1 - rx0 && Hb * sc <= ry1 - ry0;
    if (proj.scale === 'auto') { const x = STD_SCALES.find(fit); return x ? { s: x, fits: true } : { s: STD_SCALES[STD_SCALES.length - 1], fits: false }; }
    return { s: proj.scale, fits: fit(proj.scale) };
  })();
  const ox = rx0 + Math.max(0, ((rx1 - rx0) - Wb * s) / 2), oy = ry0 + Math.max(0, ((ry1 - ry0) - Hb * s) / 2);
  const P = (u, v) => [ox + (u - u0) * s, oy + (v - v0) * s];
  // 切断面の輪郭とハッチング
  groups.forEach((g, gi) => {
    const loops = loopsOf[gi].map((lp) => lp.map(([u, v]) => P(u, v)));
    loops.forEach((lp) => lp.forEach((p, i) => E.LN(p, lp[(i + 1) % lp.length], 'OUTLINE')));
    hatchSegments(loops, gi % 2 === 0 ? 45 : 135, 3).forEach(([p, q]) => E.LN(p, q, 'HATCH'));
  });
  // 中心線
  cuts.forEach(({ o, hu }) => { const a = P(hu, o.z0), b = P(hu, o.z1); E.LN([a[0], a[1] - 3], [b[0], b[1] + 3], 'CENTER'); });
  S.filter((o) => o.kind === 'cyl').forEach((o) => {
    const cu = sec.plane === 'y' ? o.cx : o.cy, co = sec.plane === 'y' ? o.cy : o.cx;
    if (Math.abs(co - sec.at) < 0.05) { const a = P(cu, o.z0), b = P(cu, o.z1); E.LN([a[0], a[1] - 3], [b[0], b[1] + 3], 'CENTER'); }
  });
  // 穴の説明 (切断面の上へ引き出す)
  const placed = [];
  cuts.sort((p, q) => p.hu - q.hu).forEach(({ o, h, key, hu }) => {
    const top = P(hu + holeRim(h), o.z1), text = holeText(h), tw = textW(text, 3.2) * 1.1 + 2.5;
    let lvl = 0, rect;
    for (; lvl < 6; lvl++) {
      const y = top[1] + 9 + lvl * 6.5;
      rect = [top[0] + 5, y, top[0] + 5 + tw, y + 4.7];
      if (!placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1])) break;
    }
    placed.push(rect);
    const p1 = [top[0] + 5, rect[1]];
    E.LN(top, p1, 'DIM'); E.LN(p1, [p1[0] + tw, p1[1]], 'DIM'); E.arrow(top, [5 / Math.hypot(5, p1[1] - top[1]), (p1[1] - top[1]) / Math.hypot(5, p1[1] - top[1])]);
    E.T(text, p1[0] + 1, p1[1] + 0.9, 3.2, { layer: 'DIM', anchor: 'start' });
    have.add(`sec:${sec.label}:${key}`);
  });
  // 外形寸法
  if (auto) {
    E.chain([P(u0, v0), P(u1, v0)], [0, -1], 10, [nf(Math.round(Wb * 1000) / 1000)]);
    E.chain([P(u0, v0), P(u0, v1)], [-1, 0], 10, [nf(Math.round(Hb * 1000) / 1000)]);
    have.add(`sec:${sec.label}:w`); have.add(`sec:${sec.label}:h`);
  } else E.T('※ 寸法は未記入です (dimensions: none)', ox, oy - 10, 3.6, { anchor: 'start' });
  const L = sec.label;
  E.T(`${L}-${L} 断面`, ox, oy - (auto ? 26 : 8), 5, { anchor: 'start' });
  E.T(`S=${scaleText(s)}  (${sec.plane === 'y' ? `y=${nf(sec.at)} で切断・手前から見る` : `x=${nf(sec.at)} で切断・右から見る`})`, ox + 30, oy - (auto ? 26 : 8), 3.2, { anchor: 'start' });
  const pj = { ...proj, title: `${proj.title} 断面図 ${L}-${L}`, drawing_no: `${proj.drawing_no}-S${L}` };
  sheetDecor(prims, { proj: pj, revRows, scaleStr: scaleText(s), asm, labels: { material: '材質', kind: ['図の種類', '断面図'] } });
  return { prims, scale: s, fits, need: [...need], have: [...have], paper: proj.paper, roughness: [], bbox: { W: Wb, D: 0, H: Hb }, title: pj.title, drawing_no: pj.drawing_no, state: 'done' };
}

/* 平面図(上面図)に切断線を描く: 太い端部・細い一点鎖線・視線方向の矢印・記号 */
function drawCutLines(prims, cuts, TX, TY, xmin, xmax, ymin, ymax) {
  const E = archEmit(prims);
  cuts.forEach((c) => {
    if (c.plane === 'y') {
      const y = TY(c.at), xa = TX(xmin) - 8, xb = TX(xmax) + 8;
      E.LN([xa + 7, y], [xb - 7, y], 'CENTER');
      [[xa, xa + 7, xa], [xb - 7, xb, xb]].forEach(([p, q, ex]) => { E.LN([p, y], [q, y], 'OUTLINE'); E.LN([ex, y], [ex, y + 8], 'DIM'); E.arrow([ex, y + 8], [0, -1]); E.T(c.label, ex, y + 10, 4.5, { layer: 'DIM' }); });
    } else {
      const x = TX(c.at), ya = TY(ymin) - 8, yb = TY(ymax) + 8;
      E.LN([x, ya + 7], [x, yb - 7], 'CENTER');
      [[ya, ya + 7, ya], [yb - 7, yb, yb]].forEach(([p, q, ey]) => { E.LN([x, p], [x, q], 'OUTLINE'); E.LN([x, ey], [x - 8, ey], 'DIM'); E.arrow([x - 8, ey], [1, 0]); E.T(c.label, x - 11, ey - 1.5, 4.5, { layer: 'DIM' }); });
    }
  });
}
