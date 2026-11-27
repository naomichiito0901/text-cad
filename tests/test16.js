const { launch } = require('./browser');
const S = require('path').join(process.env.CAD_OUT || '/tmp/cad-out', '/'); require('fs').mkdirSync(S, { recursive: true });
const head = 'mode: 3d\ndomain: mechanical\nproject: {title: 形状, drawing_no: F-1, material: SS400, designer: a, drafter: b, date: 2026-11-25, rev: A}\nparts:\n';
const cases = {
  ft: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], fillet: 3}\n',
  fb: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], fillet_bottom: 2}\n',
  both: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], fillet: 3, fillet_bottom: 2}\n',
  mix: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], chamfer: 2, fillet_bottom: 3}\n',
  big: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], fillet: 9.5, fillet_bottom: 9.5}\n',
};
(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1300, height: 800 }, acceptDownloads: true })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../dist-offline/index.html'));
  await p.waitForTimeout(400);
  await p.click('[data-step="2"]');
  for (const [k, y] of Object.entries(cases)) {
    await p.fill('#editor', y);
    await p.waitForTimeout(1000);
    const err = (await p.textContent('#error')) || '';
    if (err) { console.log('[' + k + '] ERROR:', err); continue; }
    let [d] = await Promise.all([p.waitForEvent('download'), p.click('#dl-step')]);
    await d.saveAs(S + 'h_' + k + '.step');
    [d] = await Promise.all([p.waitForEvent('download'), p.click('#dl-stl')]);
    await d.saveAs(S + 'h_' + k + '.stl');
    console.log('[' + k + ']', await p.textContent('#status'));
  }
  // エラー系
  for (const [k, y] of Object.entries({ 'C+R同端': head + '  - cylinder: {name: c, diameter: 20, height: 30, chamfer: 2, fillet: 3}\n', 'R>=半径': head + '  - cylinder: {name: c, diameter: 20, height: 30, fillet: 10}\n', '高さ超過': head + '  - cylinder: {name: c, diameter: 20, height: 5, fillet: 3, fillet_bottom: 3}\n' })) {
    await p.fill('#editor', y);
    await p.waitForTimeout(600);
    console.log('[' + k + ']', (await p.textContent('#error')) || '(エラーなし!)');
  }
  console.log('ERRORS', errs);
  await b.close();
})();
