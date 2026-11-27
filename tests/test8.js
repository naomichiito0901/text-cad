const { launch } = require('./browser');
const S = require('path').join(process.env.CAD_OUT || '/tmp/cad-out', '/'); require('fs').mkdirSync(S, { recursive: true });
const head = 'mode: 2d\ndomain: architecture\nproject: {title: 検証, drawing_no: T-1, designer: a, drafter: b, date: 2026-11-25, standard: JIS A 0150, due: 2026-12-01}\n';
const cases = {
  overlap: head + 'walls:\n  - [[0,0],[4000,0],[4000,3000],[0,3000],[0,0]]\n  - {from: [2000, 0], to: [6000, 0]}\nrooms: [{name: 洋室, at: [1000, 1000]}]\n',
  leak: head + 'walls:\n  - [[0,0],[4000,0],[4000,3000],[0,3000]]\nrooms: [{name: 洋室, at: [1000, 1000]}]\n',
  dark: head + 'height: 2000\nwalls:\n  - [[0,0],[4000,0],[4000,3000],[0,3000],[0,0]]\ndoors:\n  - {wall: 1, position: 500, width: 700}\nwindows:\n  - {wall: 3, position: 500, width: 600, height: 600}\nrooms: [{name: 寝室, at: [1000, 1000]}]\n',
  swing: head + 'walls:\n  - [[0,0],[4000,0],[4000,3000],[0,3000],[0,0]]\n  - {from: [1500, 0], to: [1500, 3000]}\ndoors:\n  - {wall: 1, position: 800, width: 900}\n  - {wall: 1, position: 2600, width: 900}\nrooms: [{name: 洋室, at: [800, 1500]}, {name: 和室, at: [3000, 1500]}]\n',
  oblique: head + 'walls:\n  - [[0,0],[4000,0],[4000,3000],[0,3000],[0,0]]\n  - {from: [0, 0], to: [4000, 3000]}\nrooms: [{name: 洋室, at: [3000, 800]}]\n',
  nodim: head.replace('}\n', '}\n') + 'dimensions: none\nwalls:\n  - [[0,0],[4000,0],[4000,3000],[0,3000],[0,0]]\n',
  bad: head + 'walls:\n  - [[0,0],[4000,0]]\ndoors:\n  - {wall: 3, position: 100, width: 900}\n',
  small: head.replace('paper', 'paper') + 'project2: {}\nwalls:\n  - [[0,0],[40000,0],[40000,30000],[0,30000],[0,0]]\nrooms: [{name: 大空間, at: [20000, 15000]}]\n',
};
(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 860 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../dist/index.html')); await p.waitForTimeout(400);
  await p.click('[data-domain=architecture]'); await p.waitForTimeout(300);
  for (const [k, y] of Object.entries(cases)) {
    await p.click('[data-step="2"]'); await p.fill('#editor', y); await p.waitForTimeout(700);
    const err = (await p.textContent('#error')) || '';
    if (err) { console.log(`[${k}] error:`, err); continue; }
    await p.click('[data-step="5"]'); await p.waitForTimeout(400);
    const bad = await p.$$eval('tr.row-error, tr.row-warn', t => t.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 140)));
    console.log(`[${k}]`, bad.length ? bad : 'すべてOK');
    if (k === 'swing' || k === 'overlap') { await p.click('[data-step="3"]'); await p.waitForTimeout(500); await p.screenshot({ path: S + `arch-${k}.png` }); console.log('   step3:', (await p.textContent('#resultbar')).replace(/\s+/g, ' ').slice(0, 200)); }
  }
  console.log('ERRORS', errs); await b.close();
})();
