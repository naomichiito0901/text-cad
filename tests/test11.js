const { launch } = require('./browser');
const proj = 'project: {title: 検証, drawing_no: T-1, designer: a, drafter: b, date: 2026-11-25, standard: JIS B 0001, general_tolerance: x, finish: Ra 6.3, due: 2026-12-01, rev: A}\n';
const asm = (headD) => `mode: 3d\ndomain: mechanical\n${proj}components:\n  plate:\n    title: プレート\n    material: SS400\n    parts:\n      - box: {name: body, size: [40, 40, 12]}\n      - hole: {target: body, diameter: 6.6, at: [20, 20], cbore_d: 11, cbore_depth: 6.5}\n  bolt:\n    title: ボルト\n    material: S45C\n    parts:\n      - cylinder: {name: head, diameter: ${headD}, height: 6, at: [0, 0, 5.5], chamfer: 0.5}\n      - cylinder: {name: shank, diameter: 6.4, height: 20, at: [0, 0, -14.5]}\nassembly:\n  - {id: P1, part: plate}\n  - {id: B1, part: bolt, at: [20, 20, 0]}\n`;
const single = (lines) => `mode: 3d\ndomain: mechanical\n${proj}parts:\n${lines}`;
const errCases = {
  'depth>=板厚': single('  - box: {name: a, size: [30,30,10]}\n  - hole: {target: a, diameter: 5, at: [15,15], depth: 10}\n'),
  'cbore_d<=d': single('  - box: {name: a, size: [30,30,10]}\n  - hole: {target: a, diameter: 8, at: [15,15], cbore_d: 8, cbore_depth: 3}\n'),
  'csk too deep': single('  - box: {name: a, size: [30,30,4]}\n  - hole: {target: a, diameter: 4, at: [15,15], csk_d: 20, csk_angle: 60}\n'),
  'R+C同時': single('  - box: {name: a, size: [30,30,10], corner_radius: 3, chamfer: 1}\n'),
  'R too big': single('  - box: {name: a, size: [30,30,10], corner_radius: 15}\n'),
  '角Rに穴': single('  - box: {name: a, size: [30,30,10], corner_radius: 8}\n  - hole: {target: a, diameter: 5, at: [4,4]}\n'),
  'chamfer>高さ': single('  - box: {name: a, size: [30,30,4], chamfer: 2, chamfer_bottom: 2}\n'),
  'blind no depth': single('  - box: {name: a, size: [30,30,10]}\n  - hole: {target: a, diameter: 5, at: [15,15], type: blind}\n'),
  '面取り内に穴': single('  - box: {name: a, size: [30,30,10], chamfer: 3}\n  - hole: {target: a, diameter: 5, at: [4,15]}\n'),
  'type不正': single('  - box: {name: a, size: [30,30,10]}\n  - hole: {target: a, diameter: 5, at: [15,15], type: taper}\n'),
};
(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../dist-offline/index.html')); await p.waitForTimeout(400);
  await p.click('[data-step="3"]');
  for (const hd of [10.5, 11.5]) {
    await p.fill('#editor', asm(hd)); await p.waitForTimeout(1200);
    console.log(`ボルト頭 φ${hd}:`, (await p.textContent('#status')), '|', (await p.textContent('#resultbar')).replace(/\s+/g, ' ').slice(0, 130), '| err:', (await p.textContent('#error')) || '-');
  }
  await p.click('[data-step="5"]'); await p.waitForTimeout(300);
  await p.fill('#editor', asm(10.5)); await p.waitForTimeout(1000);
  console.log('組立の検図(NG/警告):', await p.$$eval('tr.row-error, tr.row-warn, tr.row-info', t => t.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 150))));
  for (const [k, y] of Object.entries(errCases)) { await p.fill('#editor', y); await p.waitForTimeout(500); console.log(`[${k}]`, (await p.textContent('#error')) || '(エラーなし!)'); }
  console.log('ERRORS', errs); await b.close();
})();
