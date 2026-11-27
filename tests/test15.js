const { chromium } = require('playwright');
const S = require('path').join(process.env.CAD_OUT || '/tmp/cad-out', '/'); require('fs').mkdirSync(S, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../dist/index.html'));
  await p.waitForTimeout(400);
  const st = async () => (await p.textContent('#status')) + ' | err:' + ((await p.textContent('#error')) || '-');
  for (const [name, btn] of [['holes', '#load-holes']]) {
    await p.click(btn);
    await p.waitForTimeout(1200);
    await p.click('[data-step="4"]');
    await p.waitForTimeout(800);
    console.log(name, 'tabs:', await p.$$eval('#resultbar button', (t) => t.map((x) => x.textContent)));
    const n = (await p.$$('#resultbar button')).length;
    for (let i = 1; i <= n; i++) {
      await p.click('#resultbar button:nth-child(' + i + ')');
      await p.waitForTimeout(700);
      const label = await p.textContent('#resultbar button:nth-child(' + i + ')');
      console.log('  ', label, '|', await st());
      await p.screenshot({ path: S + 'sec-' + name + '-' + i + '.png' });
    }
    await p.click('[data-step="5"]');
    await p.waitForTimeout(400);
    console.log(' 検図NG:', await p.$$eval('tr.row-error, tr.row-warn', (t) => t.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 160))));
  }
  console.log('ERRORS', errs);
  await b.close();
})();
