// 三面図: 旧 (形状から手で線を作る) と新 (OpenCascade の隠れ線処理) の比較。 新旧の一致を確かめるための一時的な検証 (旧処理を消すときに一緒に消す)。
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
  const all = { ...Object.fromEntries(Object.entries(cases).map(([k, y]) => [k, { yaml: y }])), ...Object.fromEntries(Object.entries(samples).map(([k, btn]) => [k, { btn }])), 'asm-bolt': { yaml: interference['bolt-hit'].yaml },
    'stack': { yaml: cases.cr.replace('  - box: {name: p, size: [100, 50, 10], corner_radius: 8}\n', '  - box: {name: p, size: [100, 50, 10]}\n  - box: {name: q, size: [40, 30, 20], at: [20, 10, 10]}\n  - cylinder: {name: c, diameter: 12, height: 8, at: [80, 25, 10]}\n') } };
  const grab = () => p.evaluate(() => window.__cad.wf.drawings.map((dw) => ({ key: dw.key, state: dw.d.state, scale: dw.d.scale, prims: dw.d.prims.filter((q) => (q.layer === 'OUTLINE' || q.layer === 'HIDDEN') && !dw.key.startsWith('sec')), rest: dw.d.prims.filter((q) => q.layer !== 'OUTLINE' && q.layer !== 'HIDDEN'), need: dw.d.need, have: dw.d.have, scale: dw.d.scale })));
  const rows = [];
  for (const [k, c] of Object.entries(all)) {
    await p.evaluate(() => { window.__oldViews = false; });
    if (c.yaml) await p.fill('#editor', c.yaml); else if (c.btn) await p.click(c.btn); else await p.fill('#editor', initial);
    await p.waitForTimeout(1200);
    if (await p.evaluate(() => !window.__cad.wf)) { console.log(k, 'ERR', await p.textContent('#error')); continue; }
    const nw = await grab();
    await p.evaluate(() => { window.__oldViews = true; });
    await p.fill('#editor', (await p.inputValue('#editor')) + '\n# old'); await p.waitForTimeout(1200);
    const old = await grab();
    rows.push({ k, nw, old });
  }
  fs.writeFileSync((process.env.CAD_OUT || '/tmp') + '/views-compare.json', JSON.stringify(rows));
  console.log('cases', rows.length, 'errs', errs);
  await b.close();
})();
