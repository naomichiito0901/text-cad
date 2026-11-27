const { launch } = require('./browser');
const S = require('path').join(process.env.CAD_OUT || '/tmp/cad-out', '/'); require('fs').mkdirSync(S, { recursive: true });
(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../dist-offline/index.html')); await p.waitForTimeout(400);
  await p.click('[data-domain=architecture]'); await p.waitForTimeout(500);
  await p.click('[data-step="2"]'); await p.waitForTimeout(500);
  let [d] = await Promise.all([p.waitForEvent('download'), p.click('#dl-ifc')]);
  await d.saveAs(S + 'sample.ifc'); console.log('ifc', d.suggestedFilename());
  // 承認 → 納品zip
  await p.click('[data-step="5"]'); await p.fill('#appr-name', '検図者A'); await p.click('[data-act="approve"]'); await p.waitForTimeout(300);
  await p.click('[data-step="6"]'); await p.waitForTimeout(300);
  [d] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="zip"]')]);
  await d.saveAs(S + 'arch.zip'); console.log('zip', d.suggestedFilename());
  // 別ケース(IFC): L字・斜め壁・窓なし・回転
  const y = `mode: 2d\ndomain: architecture\nproject: {title: 検証, drawing_no: T-1, designer: a, drafter: b, date: 2026-11-25}\nfloor: true\nwalls:\n  - [[0,0],[5000,0],[5000,2000],[2500,2000],[2500,4000],[0,4000],[0,0]]\ndoors:\n  - {wall: 1, position: 500, width: 1000, hinge: end}\nwindows:\n  - {wall: 6, position: 1000, width: 1500, sill: 1000, height: 1000}\nrooms:\n  - {name: L字室, at: [1000, 1000]}\n`;
  await p.click('[data-step="2"]'); await p.fill('#editor', y); await p.waitForTimeout(600);
  console.log('L-shape:', await p.textContent('#status'), '|', (await p.textContent('#error')) || '-');
  [d] = await Promise.all([p.waitForEvent('download'), p.click('#dl-ifc')]);
  await d.saveAs(S + 'lshape.ifc');
  console.log('ERRORS', errs); await b.close();
})();
