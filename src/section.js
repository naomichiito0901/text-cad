/* =====================================================================
 * 断面図 (A-A 断面)  切断面の輪郭は計算エンジン (OpenCascade) で部品ごとに求め (kernel-model.js の sectionFor)、ここでハッチングと寸法を引く
 *   plane: y → 面 y=at で切り、手前(-y側)から見る (横軸 x)
 *   plane: x → 面 x=at で切り、右(+x側)から見る  (横軸 y)
 * ===================================================================== */
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
