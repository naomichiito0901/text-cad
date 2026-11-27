const { launch } = require('./browser');
const S = require('path').join(process.env.CAD_OUT || '/tmp/cad-out', '/'); require('fs').mkdirSync(S, { recursive: true });
(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../dist/index.html')); await p.waitForTimeout(400);
  const st = async () => (await p.textContent('#status')) + ' | err:' + ((await p.textContent('#error')) || '-');
  await p.click('[data-domain=architecture]'); await p.waitForTimeout(500);
  console.log('steps visible:', await p.isVisible('#steps'));
  for (const n of [1, 2, 3, 4, 5, 6]) {
    await p.click(`[data-step="${n}"]`); await p.waitForTimeout(700);
    console.log('step', n, await st());
    await p.screenshot({ path: S + `arch-step${n}.png` });
  }
  await p.click('[data-step="4"]'); await p.waitForTimeout(300);
  console.log('tabs:', await p.$$eval('#resultbar button', t => t.map(x => x.textContent)));
  await p.click('#resultbar button:nth-child(2)'); await p.waitForTimeout(500);
  console.log(await st()); await p.screenshot({ path: S + 'arch-elev.png' });
  await p.click('[data-step="5"]'); await p.waitForTimeout(300);
  console.log('rules NG:', await p.$$eval('tr.row-error, tr.row-warn, tr.row-info', t => t.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 220))));
  console.log('ERRORS', errs); await b.close();
})();
