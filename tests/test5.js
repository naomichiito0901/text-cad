const { chromium } = require('playwright');
const S = require('path').join(process.env.CAD_OUT || '/tmp/cad-out', '/'); require('fs').mkdirSync(S, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../dist/index.html')); await p.waitForTimeout(400);
  const st = async () => (await p.textContent('#status')) + ' | err:' + ((await p.textContent('#error')) || '-');
  await p.click('#load-asm'); await p.waitForTimeout(500);
  for (const n of [1, 2, 3, 4, 5, 6]) {
    await p.click(`[data-step="${n}"]`); await p.waitForTimeout(600);
    console.log('step', n, await st());
    await p.screenshot({ path: S + `asm-step${n}.png` });
  }
  await p.click('[data-step="4"]'); await p.waitForTimeout(400);
  console.log('tabs:', await p.$$eval('#resultbar button', t => t.map(x => x.textContent)));
  await p.click('#resultbar button:nth-child(2)'); await p.waitForTimeout(500);
  console.log('part drawing:', await st()); await p.screenshot({ path: S + 'asm-part1.png' });
  await p.click('#resultbar button:nth-child(3)'); await p.waitForTimeout(500);
  console.log('part drawing:', await st()); await p.screenshot({ path: S + 'asm-part2.png' });
  await p.click('[data-step="5"]'); await p.waitForTimeout(300);
  console.log('rules NG:', await p.$$eval('tr.row-error, tr.row-warn, tr.row-info', t => t.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 200))));
  await p.fill('#appr-name', '検図者A'); if (await p.$('#appr-ack')) await p.check('#appr-ack');
  await p.click('[data-act="approve"]'); await p.waitForTimeout(300);
  await p.click('[data-step="6"]'); await p.waitForTimeout(300);
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="zip"]')]);
  await d.saveAs(S + 'asm.zip'); console.log('zip', d.suggestedFilename());
  // interference: pin too fat
  let y = (await p.inputValue('#editor')).replace('diameter: 7.99', 'diameter: 8.4'); await p.fill('#editor', y); await p.waitForTimeout(600);
  await p.click('[data-step="3"]'); await p.waitForTimeout(500);
  console.log('fat pin:', await st(), '|', (await p.textContent('#resultbar')).replace(/\s+/g, ' ').slice(0, 220));
  // floating + rotate
  y = (await p.inputValue('#editor')).replace('diameter: 8.4', 'diameter: 7.99').replace('at: [80, 25, -5]', 'at: [80, 25, 40], rotate: 90'); await p.fill('#editor', y); await p.waitForTimeout(600);
  console.log('floating:', await st(), '|', (await p.textContent('#resultbar')).replace(/\s+/g, ' ').slice(0, 220));
  // unknown part
  await p.fill('#editor', (await p.inputValue('#editor')).replace('part: pin, at: [20', 'part: nopin, at: [20')); await p.waitForTimeout(500);
  console.log('bad part:', await p.textContent('#error'));
  console.log('ERRORS', errs); await b.close();
})();
