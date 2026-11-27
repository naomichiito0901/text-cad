const { launch } = require('./browser');
const S = require('path').join(process.env.CAD_OUT || '/tmp/cad-out', '/'); require('fs').mkdirSync(S, { recursive: true });
const head = 'mode: 3d\ndomain: mechanical\nproject: {title: 形状, drawing_no: F-1, material: SS400, designer: a, drafter: b, date: 2026-11-25, rev: A}\nparts:\n';
const cases = {
  thread: head + '  - box: {name: p, size: [60, 40, 14]}\n  - hole: {target: p, thread: M6, at: [15, 20]}\n  - hole: {target: p, thread: M8, thread_depth: 8, depth: 13, at: [45, 20]}\n',
  tilt: head + '  - box: {name: p, size: [60, 40, 14]}\n  - hole: {target: p, diameter: 6, at: [20, 20], tilt: 30, tilt_dir: "+x"}\n  - hole: {target: p, diameter: 5, at: [45, 12], tilt: 20, tilt_dir: "+y"}\n',
  tilt2: head + '  - box: {name: p, size: [60, 40, 14]}\n  - hole: {target: p, diameter: 6, at: [40, 20], tilt: 25, tilt_dir: "-x"}\n  - hole: {target: p, diameter: 5, at: [20, 30], tilt: 40, tilt_dir: "-y"}\n',
  slotx: head + '  - box: {name: p, size: [60, 40, 14]}\n  - slot: {target: p, width: 8, length: 28, at: [30, 20], dir: x}\n',
  sloty: head + '  - box: {name: p, size: [60, 40, 14]}\n  - slot: {target: p, width: 6, length: 24, at: [30, 20], dir: y}\n  - hole: {target: p, diameter: 5, at: [8, 8]}\n',
  all: head + '  - box: {name: p, size: [100, 60, 14]}\n  - hole: {target: p, thread: M6, at: [15, 15]}\n  - hole: {target: p, diameter: 6, at: [50, 15], tilt: 30, tilt_dir: "+x"}\n  - slot: {target: p, width: 8, length: 28, at: [78, 30], dir: y}\n',
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
    await p.waitForTimeout(1100);
    const err = (await p.textContent('#error')) || '';
    if (err) { console.log('[' + k + '] ERROR:', err); continue; }
    let [d] = await Promise.all([p.waitForEvent('download'), p.click('#dl-step')]);
    await d.saveAs(S + 'g_' + k + '.step');
    [d] = await Promise.all([p.waitForEvent('download'), p.click('#dl-stl')]);
    await d.saveAs(S + 'g_' + k + '.stl');
    console.log('[' + k + ']', await p.textContent('#status'));
  }
  console.log('ERRORS', errs);
  await b.close();
})();
