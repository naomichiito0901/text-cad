// 断面: 旧 (JSCAD の 2D ブーリアン) と新 (OpenCascade) の比較。 PR で新旧の一致を確かめるための一時的な検証 (旧処理を消すときに一緒に消す)。
const { launch } = require('./browser');
const fs = require('fs');
const path = require('path');
const { cases, samples, interference } = require('./cases');
(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1300, height: 800 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto('file://' + path.resolve(__dirname, '../dist-offline/index.html'));
  await p.click('[data-step="2"]');
  const initial = await p.inputValue('#editor');
  const all = { ...Object.fromEntries(Object.entries(cases).map(([k, y]) => [k, { yaml: y }])), ...Object.fromEntries(Object.entries(samples).map(([k, btn]) => [k, { btn }])),
    'asm-bolt': { yaml: interference['bolt-hit'].yaml } };
  const rows = [];
  for (const [k, c] of Object.entries(all)) {
    if (c.yaml) await p.fill('#editor', c.yaml); else if (c.btn) await p.click(c.btn); else await p.fill('#editor', initial);
    await p.waitForTimeout(900);
    const out = await p.evaluate(async () => {
      const A = window.__cad, wf = A.wf, S = wf.solids, { geom2 } = A.jscad.geometries, { subtract } = A.jscad.booleans, { measureArea } = A.jscad.measurements;
      const model = A.kernelModelOf(S), res = [];
      const ats = (plane) => {
        const lo = Math.min(...S.map((o) => o[plane + '0'])), hi = Math.max(...S.map((o) => o[plane + '1'])), set = new Set();
        S.forEach((o) => { o.holes.forEach((h) => set.add(+(plane === 'y' ? h.y : h.x).toFixed(4))); (o.slots || []).forEach((s) => set.add(+(plane === 'y' ? s.cy : s.cx).toFixed(4))); if (o.kind === 'cyl') set.add(+((o[plane + '0'] + o[plane + '1']) / 2).toFixed(4)); });
        [0.13, 0.31, 0.5, 0.77].forEach((f) => set.add(+(lo + (hi - lo) * f).toFixed(4)));
        return [...set].filter((v) => v > lo + 1e-6 && v < hi - 1e-6).sort((a, b) => a - b).slice(0, 14);
      };
      const toRegion = (f) => {
        const ccw = (pts) => { let a = 0; pts.forEach(([x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; a += x * y2 - x2 * y; }); return a < 0 ? pts.slice().reverse() : pts; };
        const o = geom2.fromPoints(ccw(f.outer));
        return f.holes.length ? subtract(o, ...f.holes.map((h) => geom2.fromPoints(ccw(h)))) : o;
      };
      for (const plane of ['y', 'x']) for (const at of ats(plane)) {
        const old = A.sectionGroups(S, plane, at);
        const nw = (await A.kernel.call('section', { model, plane, at })).groups;
        const row = { plane, at, oldGroups: old.length, newGroups: nw.length, oldLoops: 0, newLoops: 0, areaOld: 0, areaNewExact: 0, areaNewPoly: 0, sym: 0, keys: old.map((g) => g.key).join(',') === nw.map((g) => (g.key === null ? '_' : g.key)).join(',') };
        old.forEach((g) => { row.oldLoops += geom2.toOutlines(g.region).length; row.areaOld += measureArea(g.region); });
        nw.forEach((g) => { row.areaNewExact += g.area; g.faces.forEach((f) => { row.newLoops += 1 + f.holes.length; row.areaNewPoly += measureArea(toRegion(f)); }); });
        // 形の差: 格子点 (0.05 mm 間隔) ごとに、旧と新で内側かどうかを比べ、食い違った格子の面積 (部品ごとの偶奇則)
        const inside = (loops, x, y) => { let c = false; loops.forEach((lp) => lp.forEach((a, i) => { const b = lp[(i + 1) % lp.length]; if ((a[1] > y) !== (b[1] > y) && x < a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])) c = !c; })); return c; };
        row.oldLoopAreas = [];
        if (old.length === nw.length) old.forEach((g, i) => {
          const ol = geom2.toOutlines(g.region), nl = nw[i].faces.flatMap((f) => [f.outer, ...f.holes]);
          ol.forEach((lp) => { let a = 0; lp.forEach(([x, y], k) => { const [x2, y2] = lp[(k + 1) % lp.length]; a += x * y2 - x2 * y; }); row.oldLoopAreas.push(Math.abs(a / 2)); });
          const all = ol.flat().concat(nl.flat()), x0 = Math.min(...all.map((q) => q[0])), x1 = Math.max(...all.map((q) => q[0])), y0 = Math.min(...all.map((q) => q[1])), y1 = Math.max(...all.map((q) => q[1]));
          const h = 0.05; let bad = 0;
          for (let x = x0 + h / 2; x < x1; x += h) for (let y = y0 + h / 2; y < y1; y += h) if (inside(ol, x, y) !== inside(nl, x, y)) bad++;
          row.sym += bad * h * h;
        });
        // 図面 (ハッチング・輪郭・寸法) の比較: 旧の輪郭を渡した図面と、新の輪郭を渡した図面
        const sec = { plane, at, label: 'A' }, revRows = [{ rev: 'A', date: '2026-01-01', note: '初版' }];
        const oldData = { state: 'done', groups: old.map((g) => ({ key: g.key, loops: geom2.toOutlines(g.region).map(A.collinearReduce).filter((l) => l.length >= 3) })) };
        const newData = { state: 'done', groups: nw.map((g) => ({ key: g.key, loops: g.faces.flatMap((f) => [f.outer, ...f.holes]).map(A.collinearReduce).filter((l) => l.length >= 3) })) };
        const dO = A.buildSectionDrawing(S, wf.project, revRows, sec, false, oldData), dN = A.buildSectionDrawing(S, wf.project, revRows, sec, false, newData);
        const len = (d, layer) => d.prims.filter((q) => q.layer === layer && q.t === 'line').reduce((t, q) => t + Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]), 0);
        const cnt = (d, layer) => d.prims.filter((q) => q.layer === layer && q.t === 'line').length;
        const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.002 : Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => same(v, b[i])) : a && b && typeof a === 'object' && typeof b === 'object' ? Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => same(a[k], b[k])) : a === b);
        const rest = (d) => d.prims.filter((q) => q.layer !== 'HATCH' && q.layer !== 'OUTLINE');
        const fo = dO.prims.filter((q) => q.layer !== 'HATCH' && q.layer !== 'OUTLINE'), fn = dN.prims.filter((q) => q.layer !== 'HATCH' && q.layer !== 'OUTLINE'); const j = (q) => JSON.stringify(q, (k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v)); let di = fo.findIndex((q, i) => !fn[i] || !same(q, fn[i])); row.diff = di < 0 ? (fo.length === fn.length ? '' : `len ${fo.length}/${fn.length}`) : `#${di}/${fo.length} ${j(fo[di])} ≠ ${fn[di] ? j(fn[di]) : '無'}`;
        row.dwg = { hatchOld: len(dO, 'HATCH'), hatchNew: len(dN, 'HATCH'), hcOld: cnt(dO, 'HATCH'), hcNew: cnt(dN, 'HATCH'), olOld: len(dO, 'OUTLINE'), olNew: len(dN, 'OUTLINE'), sameOther: same(rest(dO), rest(dN)), scaleSame: dO.scale === dN.scale, needSame: JSON.stringify(dO.need) === JSON.stringify(dN.need), haveSame: JSON.stringify(dO.have) === JSON.stringify(dN.have) };
        res.push(row);
      }
      return res;
    });
    out.forEach((r) => rows.push({ k, ...r }));
  }
  fs.writeFileSync((process.env.CAD_OUT || '/tmp') + '/section-compare.json', JSON.stringify(rows));
  let bad = 0;
  const f = (v) => v.toFixed(3);
  rows.forEach((r) => {
    const dA = r.areaOld ? (r.areaNewExact - r.areaOld) / r.areaOld * 100 : 0;
    const flag = r.oldGroups !== r.newGroups || r.oldLoops !== r.newLoops || !r.keys || Math.abs(dA) > 0.5 || r.sym > 0.01 * r.areaOld ? ' <<<' : '';
    if (flag) bad++;
    console.log(`${r.k.padEnd(10)} ${r.plane}=${String(r.at).padEnd(8)} 部品 ${r.oldGroups}/${r.newGroups} 輪郭 ${r.oldLoops}/${r.newLoops} 面積 旧${f(r.areaOld)} 新(厳密)${f(r.areaNewExact)} 新(多角形)${f(r.areaNewPoly)} 差${dA.toFixed(3)}% 不一致面積${f(r.sym)}${flag}${r.oldLoops !== r.newLoops ? ' 旧の輪郭の面積=' + r.oldLoopAreas.map(f).join('/') : ''}`);
  });
  console.log('--- 図面 (ハッチング・輪郭・寸法) の比較');
  let dBad = 0;
  rows.forEach((r) => {
    const d = r.dwg, dh = d.hatchOld ? (d.hatchNew - d.hatchOld) / d.hatchOld * 100 : 0, dc = d.hcNew - d.hcOld;
    const flag = Math.abs(dh) > 1 || Math.abs(dc) > 3 || !d.sameOther || !d.scaleSame || !d.needSame || !d.haveSame || Math.abs(d.olNew - d.olOld) > 0.01 * d.olOld;
    if (flag) { dBad++; console.log(`${r.k} ${r.plane}=${r.at}: ハッチ長 旧${d.hatchOld.toFixed(1)} 新${d.hatchNew.toFixed(1)} (${dh.toFixed(2)}%) 本数 ${d.hcOld}/${d.hcNew} 輪郭長 ${d.olOld.toFixed(1)}/${d.olNew.toFixed(1)} 他の要素同一=${d.sameOther}${r.diff ? ' [' + r.diff + ']' : ''} 尺度同一=${d.scaleSame} need=${d.needSame} have=${d.haveSame}`); }
  });
  const sum = (k) => rows.reduce((t, r) => t + r.dwg[k], 0);
  console.log(`図面 ${rows.length} 枚: ハッチ線 旧 ${sum('hcOld')} 本 / 新 ${sum('hcNew')} 本、 差のある図面 ${dBad} 枚`);
  console.log('rows', rows.length, 'mismatch', bad, 'errs', errs);
  await b.close();
})();
