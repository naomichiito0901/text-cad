// 断面図 (計算エンジン = OpenCascade で切る) の検証。
//  1. 断面の面積を、部品ごとに、理論値 (高さごとの「材料の長さ」を足し上げた値。 立体の記述だけから求め、計算エンジンの結果は使わない) と照合する
//  2. 断面図のハッチングが、その面積と合うこと (ハッチ線の総長 × 間隔 ≒ 面積 × 尺度²)。 輪郭の線がある。 寸法の記入漏れがない
//  3. 計算エンジンが使えないとき (Web 版を file:// で開く): 断面図の代わりの案内が出て、検図で止まる (承認できない)
const { launch } = require('./browser');
const path = require('path');
const { cases, samples, interference } = require('./cases');

(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1300, height: 800 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' ' + info : ''}`); if (!ok) errs.push(name); };
  await p.goto('file://' + path.resolve(__dirname, '../dist-offline/index.html'));
  await p.click('[data-step="2"]');
  const initial = await p.inputValue('#editor');
  const all = { ...Object.fromEntries(Object.entries(cases).map(([k, y]) => [k, { yaml: y }])), ...Object.fromEntries(Object.entries(samples).map(([k, btn]) => [k, { btn }])), 'asm-bolt': { yaml: interference['bolt-hit'].yaml } };

  /* ---- 1. 断面の面積 ---- */
  let rows = 0, worst = 0, worstPoly = 0, worstWhere = '';
  for (const [k, c] of Object.entries(all)) {
    if (c.yaml) await p.fill('#editor', c.yaml); else if (c.btn) await p.click(c.btn); else await p.fill('#editor', initial);
    await p.waitForTimeout(900);
    const out = await p.evaluate(async () => {
      const A = window.__cad, S = A.wf.solids, model = A.kernelModelOf(S), res = [];
      // 理論値: 切断面での、高さ z ごとの材料の区間を、立体の記述から求める
      const NZ = 6000, merge = (iv) => { iv.sort((a, b) => a[0] - b[0]); const o = []; iv.forEach((q) => { if (o.length && q[0] <= o[o.length - 1][1]) o[o.length - 1][1] = Math.max(o[o.length - 1][1], q[1]); else o.push(q.slice()); }); return o; };
      const minus = (base, voids) => { let cur = base; merge(voids.slice()).forEach(([a, b]) => { const nx = []; cur.forEach(([p0, p1]) => { if (b <= p0 || a >= p1) nx.push([p0, p1]); else { if (a > p0) nx.push([p0, a]); if (b < p1) nx.push([b, p1]); } }); cur = nx; }); return cur; };
      const holeR = (h, z, z1) => { const pts = h.pts; if (z > pts[0].z) return pts[0].r; for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], q = pts[i + 1]; if (a.z > q.z && z <= a.z && z >= q.z) return a.r + (q.r - a.r) * (a.z - z) / (a.z - q.z); } return h.through ? pts[pts.length - 1].r : 0; };
      const material = (m, z, plane, cc) => {
        const U = plane === 'y' ? 'x' : 'y', O = plane === 'y' ? 'y' : 'x';
        const u0 = m.kind === 'cyl' ? m.cx - m.r : m[U + '0'], u1 = m.kind === 'cyl' ? m.cx + m.r : m[U + '1'];
        let iv;
        if (m.kind === 'cyl') {
          const cu = plane === 'y' ? m.cx : m.cy, co = plane === 'y' ? m.cy : m.cx, dc = cc - co, top = m.z1 - z, bot = z - m.z0;
          const ins = (t, f, ch) => (f && t < f ? f - Math.sqrt(f * f - (f - t) ** 2) : ch && t < ch ? ch - t : 0);
          const rr = m.r - Math.max(ins(top, m.ft, m.ct), ins(bot, m.fb, m.cb));
          if (rr <= Math.abs(dc)) return [];
          const hw = Math.sqrt(rr * rr - dc * dc); iv = [[cu - hw, cu + hw]];
        } else {
          const o0 = m[O + '0'], o1 = m[O + '1'], d = Math.min(cc - o0, o1 - cc);
          const ci = m.cr && d < m.cr ? m.cr - Math.sqrt(m.cr * m.cr - (m.cr - d) ** 2) : 0;
          const inset = Math.max(m.ct && m.z1 - z < m.ct ? m.ct - (m.z1 - z) : 0, m.cb && z - m.z0 < m.cb ? m.cb - (z - m.z0) : 0);
          if (d < inset) return [];
          iv = [[u0 + ci + inset, u1 - ci - inset]];
          const voids = [];
          m.holes.forEach((h) => {
            if (h.rev) { const r = holeR(h.rev, z, m.z1), ho = plane === 'y' ? h.rev.y : h.rev.x, hu = plane === 'y' ? h.rev.x : h.rev.y, dd = Math.abs(cc - ho); if (r > dd) { const w = Math.sqrt(r * r - dd * dd); voids.push([hu - w, hu + w]); } return; }
            const t = h.tilt, th = t.angle * Math.PI / 180, k = (m.z1 - z) * Math.tan(th), px = t.x + t.dir[0] * k, py = t.y + t.dir[1] * k, c2 = Math.cos(th) ** 2, [dx, dy] = t.dir, r = t.d / 2;
            const Yd = plane === 'y' ? cc - py : cc - px;
            // 断面上の座標 ξ (切断面に沿う方向) について、 c2·s² + t² ≤ r² を解く
            const ex = plane === 'y' ? [1, 0] : [0, 1], pe = plane === 'y' ? [0, 1] : [1, 0];
            const sx = ex[0] * dx + ex[1] * dy, sy = Yd * (pe[0] * dx + pe[1] * dy), tx = -ex[0] * dy + ex[1] * dx, ty = Yd * (-pe[0] * dy + pe[1] * dx);
            const A = c2 * sx * sx + tx * tx, B = 2 * (c2 * sx * sy + tx * ty), C = c2 * sy * sy + ty * ty - r * r, disc = B * B - 4 * A * C;
            if (disc > 0) { const c0 = plane === 'y' ? px : py; voids.push([c0 + (-B - Math.sqrt(disc)) / (2 * A), c0 + (-B + Math.sqrt(disc)) / (2 * A)]); }
          });
          (m.slots || []).forEach((sl) => {
            const r = sl.w / 2, D = sl.len - sl.w, cu = plane === 'y' ? sl.cx : sl.cy, co = plane === 'y' ? sl.cy : sl.cx, d2 = Math.abs(cc - co), alongU = sl.dir === (plane === 'y' ? 'x' : 'y');
            const dd = alongU ? d2 : Math.max(0, d2 - D / 2); if (dd >= r) return;
            const w = Math.sqrt(r * r - dd * dd); voids.push(alongU ? [cu - D / 2 - w, cu + D / 2 + w] : [cu - w, cu + w]);
          });
          iv = minus(iv, voids);
        }
        return iv;
      };
      const theory = (plane, cc) => { // 部品ごと (inst が同じ立体はまとめる) の断面積
        const g = new Map();
        model.forEach((m) => { const key = m.inst !== undefined ? m.inst : '_'; if (!g.has(key)) g.set(key, []); g.get(key).push(m); });
        const out = {};
        g.forEach((ms, key) => {
          const z0 = Math.min(...ms.map((m) => m.z0)), z1 = Math.max(...ms.map((m) => m.z1)), dz = (z1 - z0) / NZ; let area = 0;
          for (let i = 0; i < NZ; i++) { const z = z0 + (i + 0.5) * dz; const iv = merge(ms.filter((m) => z > m.z0 && z < m.z1).flatMap((m) => material(m, z, plane, cc))); area += iv.reduce((t, q) => t + (q[1] - q[0]), 0) * dz; }
          if (area > 1e-9) out[key] = area;
        });
        return out;
      };
      const ats = (plane) => {
        const lo = Math.min(...S.map((o) => o[plane + '0'])), hi = Math.max(...S.map((o) => o[plane + '1'])), set = new Set();
        S.forEach((o) => { o.holes.forEach((h) => set.add(+(plane === 'y' ? h.y : h.x).toFixed(4))); (o.slots || []).forEach((s) => set.add(+(plane === 'y' ? s.cy : s.cx).toFixed(4))); if (o.kind === 'cyl') set.add(+((o[plane + '0'] + o[plane + '1']) / 2).toFixed(4)); });
        [0.13, 0.31, 0.5, 0.77].forEach((f) => set.add(+(lo + (hi - lo) * f).toFixed(4)));
        return [...set].filter((v) => v > lo + 1e-6 && v < hi - 1e-6).sort((a, b) => a - b).slice(0, 14);
      };
      const polyArea = (f) => { const a = (lp) => Math.abs(lp.reduce((t, [x, y], i) => { const [x2, y2] = lp[(i + 1) % lp.length]; return t + (x * y2 - x2 * y) / 2; }, 0)); return a(f.outer) - f.holes.reduce((t, h) => t + a(h), 0); };
      for (const plane of ['y', 'x']) for (const at of ats(plane)) {
        const th = theory(plane, at), nw = (await A.kernel.call('section', { model, plane, at })).groups, got = {}, poly = {};
        nw.forEach((g) => { got[g.key === null ? '_' : g.key] = g.area; poly[g.key === null ? '_' : g.key] = g.faces.reduce((t, f) => t + polyArea(f), 0); });
        res.push({ plane, at, th, got, poly });
      }
      return res;
    });
    out.forEach((r) => {
      const keys = new Set([...Object.keys(r.th), ...Object.keys(r.got)]);
      keys.forEach((key) => {
        rows++;
        const t = r.th[key] || 0, g = r.got[key] || 0, q = r.poly[key] || 0, e = t ? Math.abs(g - t) / t * 100 : 100, ep = t ? Math.abs(q - t) / t * 100 : 100;
        if (e > worst) { worst = e; worstWhere = `${k} ${r.plane}=${r.at} ${key}`; }
        worstPoly = Math.max(worstPoly, ep);
        if (e > 0.02 || ep > 0.3) check(`断面積 ${k} ${r.plane}=${r.at} 部品 ${key}`, false, `(理論 ${t.toFixed(3)} / 厳密 ${g.toFixed(3)} / 多角形 ${q.toFixed(3)})`);
      });
    });
  }
  check(`断面の面積: ${rows} 件が理論値と一致 (厳密な面積の誤差 ${worst.toFixed(4)}% 以下 [${worstWhere}] / 図面用の多角形 ${worstPoly.toFixed(3)}% 以下)`, rows > 150 && worst <= 0.02 && worstPoly <= 0.3);

  /* ---- 2. 断面図のハッチング ---- */
  for (const [k, btn] of [['feat', '#load-feat'], ['holes', '#load-holes'], ['asm', '#load-asm']]) {
    await p.click(btn); await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const wf = window.__cad.wf;
      return wf.drawings.filter((x) => x.key.startsWith('sec')).map((dw) => {
        const d = dw.d, len = (layer) => d.prims.filter((q) => q.layer === layer && q.t === 'line').reduce((t, q) => t + Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]), 0);
        const sec = dw.d.title; return { label: dw.label, state: d.state, hatch: len('HATCH'), outline: len('OUTLINE'), scale: d.scale, miss: d.need.filter((q) => !d.have.includes(q)), sec };
      });
    });
    check(`${k}: 断面図 ${r.length} 枚が作られる`, r.length >= 1 && r.every((x) => x.state === 'done'));
    // 断面積の合計 (厳密) を同じ断面について求め、ハッチ密度と比べる
    const dens = await p.evaluate(async () => {
      const A = window.__cad, wf = A.wf, model = A.kernelModelOf(wf.solids), out = [];
      for (const dw of wf.drawings.filter((x) => x.key.startsWith('sec'))) {
        const sec = A.parseSections(wf.spec, wf.solids).find((x) => `sec${x.label}` === dw.key);
        const groups = (await A.kernel.call('section', { model, plane: String(sec.plane || 'y').toLowerCase(), at: sec.at })).groups;
        out.push({ area: groups.reduce((t, g) => t + g.area, 0), scale: dw.d.scale });
      }
      return out;
    });
    r.forEach((x, i) => {
      const expect = dens[i].area * dens[i].scale ** 2 / 3, ratio = x.hatch / expect;
      check(`${k} ${x.label}: ハッチ線の量が断面積と合う (線の総長 ${x.hatch.toFixed(0)} / 面積から ${expect.toFixed(0)}、比 ${ratio.toFixed(3)})`, ratio > 0.97 && ratio < 1.03 && x.outline > 0 && x.miss.length === 0, x.miss.length ? `(寸法の記入漏れ: ${x.miss.join(',')})` : '');
    });
  }

  /* ---- 3. 計算エンジンが使えないとき ---- */
  const q = await (await b.newContext({ viewport: { width: 1300, height: 800 } })).newPage();
  const qerrs = [];
  q.on('pageerror', (e) => qerrs.push(e.message));
  await q.goto('file://' + path.resolve(__dirname, '../dist/index.html'));
  await q.waitForFunction(() => window.__cad && window.__cad.kernel.state.phase === 'error', null, { timeout: 30000 });
  q.on('dialog', (d) => d.accept());
  await q.click('[data-step="2"]'); await q.click('#load-feat'); await q.waitForTimeout(500);
  const un = await q.evaluate(() => window.__cad.wf.drawings.filter((x) => x.key.startsWith('sec')).map((d) => ({ state: d.d.state, texts: d.d.prims.filter((p) => p.t === 'text').map((p) => p.s).join('|') })));
  check('計算エンジンなし: 断面図が unavailable になり、案内が図面に出る', un.length >= 1 && un.every((x) => x.state === 'unavailable' && /断面図を作れません/.test(x.texts)), JSON.stringify(un[0]).slice(0, 120));
  await q.click('[data-step="5"]'); await q.waitForTimeout(400);
  await q.fill('#appr-name', '検図者A');
  check('計算エンジンなし: 検図 E06 で止まり、承認できない', (await q.isDisabled('[data-act="approve"]')) && /断面図が作成できている/.test((await q.textContent('#panel')) || ''));
  check('計算エンジンなし: ページのエラーなし', qerrs.length === 0, qerrs.join(' / '));

  console.log('ERRORS', errs);
  await b.close();
})();
