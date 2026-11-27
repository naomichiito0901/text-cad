// 三面図の線 (計算エンジンの隠れ線処理) の検証。
//  1. 手計算できる形状について、見える線・隠れ線の長さと円の半径を理論値と照合する (図面に描く前の、モデル座標の値)
//  2. 図面 (工程 4) に実線 (OUTLINE)・破線 (HIDDEN) が描かれ、DXF に破線の層が出ること。 組立・部品図も
//  3. 計算エンジンが使えないとき (Web 版を file:// で開く): 案内・検図 E06 での停止・不完全な図面の出力を止める
const { launch } = require('./browser');
const path = require('path');
const { head, interference } = require('./cases');

(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1300, height: 800 }, acceptDownloads: true })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' ' + info : ''}`); if (!ok) errs.push(name); };
  await p.goto('file://' + path.resolve(__dirname, '../dist-offline/index.html'));
  await p.click('[data-step="2"]');

  /* ---- 1. 理論値 ---- */
  const R = (x) => Math.round(x * 1e4) / 1e4;
  const sq = Math.SQRT2;
  const cyl = (extra) => head + `  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 0]${extra}}\n`;
  // v / h: 見える線・隠れ線の直線の長さの合計。 vc / hc: 円 (と、つながって円になる円弧) の半径。 向き: front (横 x・縦 z) / top (横 x・縦 y) / right (横 y・縦 z)
  const theory = [
    ['貫通穴 φ8 の板', head + '  - box: {name: p, size: [60, 40, 20]}\n  - hole: {target: p, diameter: 8, at: [30, 20]}\n', {
      front: { v: 160, h: 40, vc: [], hc: [] }, top: { v: 200, h: 0, vc: [4], hc: [] }, right: { v: 120, h: 40, vc: [], hc: [] } }],
    ['止まり穴 φ8 深さ 12', head + '  - box: {name: p, size: [60, 40, 20]}\n  - hole: {target: p, diameter: 8, at: [30, 20], depth: 12}\n', {
      front: { v: 160, h: 2 * 12 + 8, vc: [], hc: [] }, top: { v: 200, h: 0, vc: [4], hc: [] }, right: { v: 120, h: 2 * 12 + 8, vc: [], hc: [] } }],
    ['座ぐり穴 φ6.6 / φ11 深さ 6.5', head + '  - box: {name: p, size: [60, 40, 20]}\n  - hole: {target: p, diameter: 6.6, at: [30, 20], cbore_d: 11, cbore_depth: 6.5}\n', {
      // 座ぐりの壁 2 本 (6.5) + 座ぐり底の円 (側面から見ると直径 11 の線) + 穴の壁 2 本 (13.5)
      front: { v: 160, h: 2 * 6.5 + 11 + 2 * 13.5, vc: [], hc: [] }, top: { v: 200, h: 0, vc: [3.3, 5.5], hc: [] }, right: { v: 120, h: 2 * 6.5 + 11 + 2 * 13.5, vc: [], hc: [] } }],
    ['円柱 φ20×30 上端 C2', cyl(', chamfer: 2'), {
      // 輪郭 2 本 (28) + 上面 (16) + 底面 (20) + 面取りの斜め 2 本 + 面取りの境目 (20)
      front: { v: 2 * 28 + 16 + 20 + 2 * 2 * sq + 20, h: 0, vc: [], hc: [] }, top: { v: 0, h: 0, vc: [8, 10], hc: [] }, right: { v: 2 * 28 + 16 + 20 + 2 * 2 * sq + 20, h: 0, vc: [], hc: [] } }],
    ['手前の箱に隠れる線', head + '  - box: {name: a, size: [40, 40, 30]}\n  - box: {name: b, size: [20, 15, 10], at: [-10, -20, 5]}\n', {
      // 正面: a の左の縁 (x=0, 高さ 30) は、手前の b (z 5〜15) に隠れる 10 が破線、残り 20 が実線
      front: { v: 20 + 30 + 40 + 40 + 2 * (20 + 10), h: 10, vc: [], hc: [] } }],
    ['ボルトが座ぐりに入る組立', interference['bolt-ok'].yaml, {
      // 上面: 座ぐりの縁 (5.5)・頭 (5.25)・頭の面取り (4.75) が見え、穴 (3.3) と軸 (3.2) は頭に隠れる
      top: { vc: [4.75, 5.25, 5.5], hc: [3.2, 3.3] } }],
  ];
  for (const [name, yaml, exp] of theory) {
    await p.fill('#editor', yaml); await p.waitForTimeout(900);
    const err = (await p.textContent('#error')) || '';
    if (err) { errs.push(`[${name}] ${err}`); continue; }
    const got = await p.evaluate(async () => {
      const A = window.__cad, o = await A.kernel.call('views', { model: A.kernelModelOf(A.wf.solids) }), res = {};
      for (const view of Object.keys(o)) {
        res[view] = {};
        for (const [cls, key] of [['visible', 'v'], ['hidden', 'h']]) {
          const list = o[view][cls], arcs = new Map();
          res[view][key] = list.filter((e) => e.k === 'line').reduce((t, e) => t + Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), 0)
            + list.filter((e) => e.k === 'poly').reduce((t, e) => t + e.pts.slice(1).reduce((u, q, i) => u + Math.hypot(q[0] - e.pts[i][0], q[1] - e.pts[i][1]), 0), 0);
          const rs = new Set(list.filter((e) => e.k === 'circle').map((e) => +e.r.toFixed(4)));
          list.filter((e) => e.k === 'arc').forEach((e) => { const k2 = `${e.c.map((x) => x.toFixed(3))}|${e.r.toFixed(4)}`; arcs.set(k2, (arcs.get(k2) || 0) + (((e.a1 - e.a0) % 360) + 360) % 360 || 360); });
          arcs.forEach((sw, k2) => { if (sw > 359) rs.add(+k2.split('|')[1]); });
          res[view][key + 'c'] = [...rs].sort((a, c) => a - c);
          res[view][key + 'arcs'] = list.filter((e) => e.k === 'arc').length - [...arcs.values()].filter((sw) => sw > 359).length * 2;
        }
      }
      return res;
    });
    for (const [view, e] of Object.entries(exp)) {
      const g = got[view];
      if (e.v !== undefined) check(`${name} ${view}: 実線の長さ ${R(e.v)}`, Math.abs(g.v - e.v) < 1e-3, `(実際 ${R(g.v)})`);
      if (e.h !== undefined) check(`${name} ${view}: 破線の長さ ${R(e.h)}`, Math.abs(g.h - e.h) < 1e-3, `(実際 ${R(g.h)})`);
      check(`${name} ${view}: 実線の円の半径 [${e.vc}]`, JSON.stringify(g.vc) === JSON.stringify(e.vc.map(R)), `(実際 [${g.vc}])`);
      check(`${name} ${view}: 破線の円の半径 [${e.hc}]`, JSON.stringify(g.hc) === JSON.stringify(e.hc.map(R)), `(実際 [${g.hc}])`);
    }
  }

  /* ---- 2. 図面 ---- */
  for (const [k, btn] of [['サンプル', null], ['組立', '#load-asm'], ['形状', '#load-feat'], ['穴', '#load-holes']]) {
    if (btn) await p.click(btn); else await p.click('#reset-text');
    await p.waitForTimeout(1000);
    const r = await p.evaluate(() => window.__cad.wf.drawings.filter((x) => !x.key.startsWith('sec')).map((dw) => ({ label: dw.label, state: dw.d.state, out: dw.d.prims.filter((q) => q.layer === 'OUTLINE').length, hid: dw.d.prims.filter((q) => q.layer === 'HIDDEN').length, dxf: window.__cad.toDXF(dw.d.prims) })));
    check(`${k}: 図面 ${r.length} 枚に実線が描かれる`, r.length >= 1 && r.every((x) => x.state === 'done' && x.out >= 8), JSON.stringify(r.map((x) => [x.out, x.hid])));
    check(`${k}: 破線の層 (HIDDEN) が DXF に出る`, r.some((x) => x.hid > 0 && /HIDDEN/.test(x.dxf.slice(x.dxf.indexOf('ENTITIES')))));
  }

  /* ---- 2'. 引出し線 (穴の径などの説明) が交差しない ---- */
  for (const [k, btn] of [['形状サンプル', '#load-feat'], ['穴サンプル', '#load-holes'], ['組立サンプル', '#load-asm'], ['サンプル', '#reset-text']]) {
    await p.click(btn); await p.waitForTimeout(1000);
    const cross = await p.evaluate(() => {
      const out = [];
      window.__cad.wf.drawings.filter((x) => !x.key.startsWith('sec')).forEach((dw) => {
        const L = dw.d.prims.filter((q) => q.t === 'line' && q.layer === 'DIM'), eq = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
        const diag = L.filter((q) => Math.abs(q.a[0] - q.b[0]) > 1e-6 && Math.abs(q.a[1] - q.b[1]) > 1e-6);
        // 引出し線 = 斜めの線 + その端から水平に伸びる文字の下線
        const leaders = diag.map((d) => [d, ...L.filter((h) => Math.abs(h.a[1] - h.b[1]) < 1e-6 && (eq(h.a, d.b) || eq(h.b, d.b)))]);
        const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        const x = (s1, s2) => o(s1.a, s1.b, s2.a) * o(s1.a, s1.b, s2.b) < -1e-9 && o(s2.a, s2.b, s1.a) * o(s2.a, s2.b, s1.b) < -1e-9;
        for (let i = 0; i < leaders.length; i++) for (let j = i + 1; j < leaders.length; j++) if (leaders[i].some((a) => leaders[j].some((b) => x(a, b)))) out.push(`${dw.label}: 引出し線 ${i + 1} と ${j + 1}`);
        out.n = (out.n || 0) + leaders.length;
      });
      return { out, n: out.n };
    });
    check(`${k}: 引出し線どうしが交差しない`, cross.out.length === 0, `(${cross.out.join(', ') || '引出し線 ' + cross.n + ' 本'})`);
  }

  /* ---- 3. 計算エンジンが使えないとき ---- */
  const q = await (await b.newContext({ viewport: { width: 1300, height: 800 }, acceptDownloads: true })).newPage();
  const qerrs = [];
  q.on('pageerror', (e) => qerrs.push(e.message));
  await q.goto('file://' + path.resolve(__dirname, '../dist/index.html'));
  await q.waitForFunction(() => window.__cad && window.__cad.kernel.state.phase === 'error', null, { timeout: 30000 });
  await q.click('[data-step="4"]'); await q.waitForTimeout(500);
  const un = await q.evaluate(() => ({ state: window.__cad.wf.drawing.state, texts: window.__cad.wf.drawing.prims.filter((x) => x.t === 'text').map((x) => x.s).join('|'), lines: window.__cad.wf.drawing.prims.filter((x) => x.layer === 'OUTLINE' || x.layer === 'HIDDEN').length }));
  check('計算エンジンなし: 三面図の線は描かれず、案内が出る', un.state === 'unavailable' && un.lines === 0 && /三面図の線を描けません/.test(un.texts));
  let got = false;
  q.once('download', () => { got = true; });
  await q.click('#dl-dxf'); await q.waitForTimeout(500);
  check('計算エンジンなし: 不完全な図面の DXF は出力しない', !got && /出力できません/.test((await q.textContent('#error')) || ''));
  await q.click('[data-step="5"]'); await q.waitForTimeout(400);
  await q.fill('#appr-name', '検図者A');
  check('計算エンジンなし: 検図 E06 で止まり、承認できない', (await q.isDisabled('[data-act="approve"]')) && /断面図・三面図が作成できている/.test((await q.textContent('#panel')) || ''));
  check('計算エンジンなし: ページのエラーなし', qerrs.length === 0, qerrs.join(' / '));

  console.log('ERRORS', errs);
  await b.close();
})();
