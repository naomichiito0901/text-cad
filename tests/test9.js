const { chromium } = require('playwright');
const S = require('path').join(process.env.CAD_OUT || '/tmp/cad-out', '/'); require('fs').mkdirSync(S, { recursive: true });
const head = 'mode: 3d\ndomain: mechanical\nproject: {title: 形状, drawing_no: F-1, material: SS400, designer: a, drafter: b, date: 2026-11-25, rev: A}\nparts:\n';
const cases = {
  cr: head + '  - box: {name: p, size: [100, 50, 10], corner_radius: 8}\n',
  chamfer: head + '  - box: {name: p, size: [60, 40, 20], chamfer: 3, chamfer_bottom: 2}\n  - hole: {target: p, diameter: 8, at: [30, 20]}\n',
  blind: head + '  - box: {name: p, size: [60, 40, 20]}\n  - hole: {target: p, diameter: 8, at: [15, 20], depth: 12}\n  - hole: {target: p, diameter: 6, at: [45, 20]}\n',
  cbore: head + '  - box: {name: p, size: [60, 40, 20]}\n  - hole: {target: p, diameter: 6.6, at: [15, 20], cbore_d: 11, cbore_depth: 6.5}\n  - hole: {target: p, diameter: 6.6, at: [45, 20], cbore_d: 11, cbore_depth: 6.5, depth: 15}\n',
  csk: head + '  - box: {name: p, size: [60, 40, 20]}\n  - hole: {target: p, diameter: 5.5, at: [15, 20], csk_d: 10.4}\n  - hole: {target: p, diameter: 5.5, at: [45, 20], csk_d: 12, csk_angle: 120, depth: 14}\n',
  cyl: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], chamfer: 2, chamfer_bottom: 3}\n',
  combo: head + '  - box: {name: p, size: [120, 60, 12], corner_radius: 6}\n  - hole: {target: p, diameter: 6.6, at: [12, 12], cbore_d: 11, cbore_depth: 6.5}\n  - hole: {target: p, diameter: 5.5, at: [108, 48], csk_d: 10.4}\n  - hole: {target: p, diameter: 8, at: [60, 30], depth: 8}\n  - cylinder: {name: c, diameter: 16, height: 20, at: [85, 30, 12], chamfer: 1.5}\n',
};
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1300, height: 800 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../dist/index.html')); await p.waitForTimeout(400);
  await p.click('[data-step="2"]');
  for (const [k, y] of Object.entries(cases)) {
    await p.fill('#editor', y); await p.waitForTimeout(900);
    const err = (await p.textContent('#error')) || '';
    if (err) { console.log(`[${k}] ERROR:`, err); continue; }
    let [d] = await Promise.all([p.waitForEvent('download'), p.click('#dl-step')]); await d.saveAs(S + `f_${k}.step`);
    [d] = await Promise.all([p.waitForEvent('download'), p.click('#dl-stl')]); await d.saveAs(S + `f_${k}.stl`);
    if (k === 'combo') await p.screenshot({ path: S + 'feat-3d.png' });
    console.log(`[${k}]`, await p.textContent('#status'));
  }
  console.log('ERRORS', errs); await b.close();
})();
