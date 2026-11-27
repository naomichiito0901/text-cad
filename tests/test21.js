// WebGL が使えない環境 (3D 表示だけができない) でも、図面・検図・承認・STEP/STL 出力・納品 zip が使えること。
// getContext('webgl') が null を返す状態を、どのブラウザでも再現して確認する。
// コンソールのエラーも許さない (WebGL が使えないことを、アプリが先に確かめてエラーを出さない)。
const { launch } = require('./browser');
const fs = require('fs');
const path = require('path');

(async () => {
  const b = await launch({ noWebgl: true });
  const p = await (await b.newContext({ viewport: { width: 1300, height: 800 }, acceptDownloads: true })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' ' + info : ''}`); if (!ok) errs.push(name); };
  const dl = async (sel) => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click(sel)]); return fs.readFileSync(await d.path()); };

  await p.goto('file://' + path.resolve(__dirname, '../dist-offline/index.html'));
  check('WebGL が無効な環境になっている', (await p.evaluate(() => document.createElement('canvas').getContext('webgl'))) === null);
  await p.waitForFunction(() => window.__cad.kernel.state.phase === 'ready', null, { timeout: 120000 });

  // 工程 2: 案内 (使えるものが分かる文言) と、出力ボタン
  await p.click('[data-step="2"]'); await p.waitForTimeout(700);
  const notice = (await p.textContent('#panel')) || '';
  check('工程2: 3D 表示ができない案内が出る', /3D 表示ができません/.test(notice));
  check('工程2: 3D 表示以外は使えることが分かる', /3D の表示だけ/.test(notice) && /それ以外は、そのまま使えます/.test(notice) && /図面/.test(notice) && /STEP/.test(notice) && /納品/.test(notice));
  check('工程2: 案内がエラー枠ではない', ((await p.textContent('#error')) || '').trim() === '');
  check('工程2: STEP・STL のボタンが出る', (await p.isVisible('#dl-step')) && (await p.isVisible('#dl-stl')));
  const step = (await dl('#dl-step')).toString('utf8'), stl = (await dl('#dl-stl')).toString('utf8');
  check('工程2: STEP が出力できる (計算エンジン・ASCII)', /cad-text \(OpenCascade\)/.test(step) && !/[^\x00-\x7f]/.test(step));
  check('工程2: STL が出力できる', /^solid /.test(stl));

  // 工程 3: 干渉の結果が見える
  await p.click('[data-step="3"]'); await p.waitForTimeout(700);
  const res = (await p.textContent('#resultbar')) || '', st3 = (await p.textContent('#status')) || '';
  check('工程3: 干渉の結果が見える', /干渉なし|確認中|干渉/.test(res) && /干渉なし/.test(res));
  check('工程3: 3D 表示なしと分かる', /3D 表示なし/.test(st3));
  check('工程3: STEP・STL のボタンが出る', (await p.isVisible('#dl-step')) && (await p.isVisible('#dl-stl')));

  // 工程 4: 図面
  await p.click('[data-step="4"]'); await p.waitForTimeout(500);
  const n2d = await p.evaluate(() => document.querySelectorAll('#svg2d *').length), st4 = (await p.textContent('#status')) || '';
  check('工程4: 図面が描かれる', n2d > 100 && /寸法 \d+\/\d+/.test(st4), `(要素 ${n2d} / ${st4.slice(0, 60)})`);

  // 工程 5: 検図と承認
  await p.click('[data-step="5"]'); await p.waitForTimeout(500);
  await p.fill('#appr-name', '検図者A'); if (await p.$('#appr-ack')) await p.check('#appr-ack');
  check('工程5: 承認ボタンが押せる', !(await p.isDisabled('[data-act="approve"]')));
  await p.click('[data-act="approve"]'); await p.waitForTimeout(400);
  check('工程5: 承認できる', /承認済み/.test((await p.textContent('#panel')) || ''));

  // 工程 6: 納品 zip
  await p.click('[data-step="6"]'); await p.waitForTimeout(400);
  const zip = (await dl('[data-act="zip"]')).toString('latin1');
  const names = ['.dxf', '.svg', '_model.step', '_model.stl', 'LICENSES.txt', 'README.txt', '_inspection-report.md'];
  check('工程6: 納品 zip を作れる (図面・STEP・STL・検図レポートなど)', names.every((n) => zip.includes(n)), `(${names.filter((n) => !zip.includes(n)).join(',') || '全て入っている'})`);

  // 建築: 3D 表示なしでも、IFC の出力と平面図
  await p.click('[data-domain="architecture"]'); await p.waitForTimeout(500);
  await p.fill('#editor', (await p.inputValue('#editor')).replace(/^mode:[ \t]*2d/m, 'mode: 3d')); await p.waitForTimeout(600); // 表示は YAML の mode: で決まる
  await p.click('[data-step="2"]'); await p.waitForTimeout(500);
  check('建築 工程2: 案内と IFC・STL のボタン', /3D 表示ができません/.test((await p.textContent('#panel')) || '') && (await p.isVisible('#dl-ifc')) && (await p.isVisible('#dl-stl')));
  const ifc = (await dl('#dl-ifc')).toString('utf8');
  check('建築 工程2: IFC が出力できる', /^ISO-10303-21;/.test(ifc) && /IFCWALL/i.test(ifc));
  await p.click('[data-step="4"]'); await p.waitForTimeout(500);
  check('建築 工程4: 平面図が描かれる', (await p.evaluate(() => document.querySelectorAll('#svg2d *').length)) > 100);

  console.log('ERRORS', errs);
  await b.close();
})();
