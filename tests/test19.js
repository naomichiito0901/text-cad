// 新旧の比較: 同じ立体から「旧実装 (自作 STEP ライター・JSCAD の STL)」と「計算エンジン (OpenCascade)」の
// STEP・STL を同じ実行で作り、cmp_<ケース>_{old,new}.{step,stl} に書き出す。
// 体積・面数・有効性の一覧と理論値の照合は validate6.py が行う。
const { launch } = require('./browser');
const fs = require('fs');
const path = require('path');
const { cases, samples } = require('./cases');

const S = path.join(process.env.CAD_OUT || '/tmp/cad-out', '/');
fs.mkdirSync(S, { recursive: true });

(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1300, height: 800 }, acceptDownloads: true })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + path.resolve(__dirname, '../dist-offline/index.html'));
  await p.waitForFunction(() => window.__cad && window.__cad.kernel.state.phase === 'ready', null, { timeout: 120000 });
  await p.click('[data-step="2"]');
  const initial = await p.inputValue('#editor');

  const all = { ...Object.fromEntries(Object.entries(cases).map(([k, y]) => [k, { yaml: y }])), ...Object.fromEntries(Object.entries(samples).map(([k, btn]) => [k, { btn }])) };
  const summary = [];
  for (const [k, c] of Object.entries(all)) {
    if (c.yaml) await p.fill('#editor', c.yaml);
    else if (c.btn) await p.click(c.btn);
    else await p.fill('#editor', initial);
    await p.waitForTimeout(900);
    const err = (await p.textContent('#error')) || '';
    // WebGL が使えないブラウザの「3D 表示できません」は、アプリの想定した案内 (立体の生成には影響しない)
    if (err && !/WebGL/.test(err)) { errs.push(`[${k}] ${err}`); continue; }
    const out = await p.evaluate(async () => {
      try {
      const wf = window.__cad.wf;
      const old = { step: window.__cad.toSTEP(wf.solids, wf.project, 'old.step'), stl: window.__cad.toSTL(wf.meshes) };
      const t0 = performance.now();
      const nw = await window.__cad.kernelExport(wf, 'new.step');
      return { old, nw, ms: Math.round(performance.now() - t0), n: wf.solids.length };
      } catch (e) { return { error: String(e.message || e) }; }
    });
    if (out.error) { errs.push(`[${k}] 計算エンジンの出力に失敗: ${out.error}`); continue; }
    fs.writeFileSync(S + `cmp_${k}_old.step`, out.old.step);
    fs.writeFileSync(S + `cmp_${k}_old.stl`, out.old.stl);
    fs.writeFileSync(S + `cmp_${k}_new.step`, out.nw.step);
    fs.writeFileSync(S + `cmp_${k}_new.stl`, out.nw.stl);
    fs.writeFileSync(S + `cmp_${k}.json`, JSON.stringify(out.nw.solids));
    summary.push(`${k}: ${out.n} 立体 / ${out.ms} ms / valid=${out.nw.solids.every((s) => s.valid)}`);
  }
  console.log(summary.join('\n'));

  // 画面の操作でも、計算エンジンの STEP / STL が出ること (読み込み済みの状態)。
  // ヘッダのボタンが無い (WebGL が使えず 3D 表示が中止される) ときは、工程 6 のパネルの同じ出力ボタンを使う
  await p.fill('#editor', cases.cbore); await p.waitForTimeout(900);
  let stepBtn = '#dl-step', stlBtn = '#dl-stl';
  if (!(await p.isVisible('#dl-step'))) {
    await p.click('[data-step="6"]'); await p.waitForTimeout(500);
    stepBtn = '[data-act="f-exp"][data-id="step"]'; stlBtn = '[data-act="f-exp"][data-id="stl"]';
  }
  const [d1] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click(stepBtn)]);
  const [d2] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click(stlBtn)]);
  const stepTxt = fs.readFileSync(await d1.path(), 'utf8'), stlTxt = fs.readFileSync(await d2.path(), 'utf8');
  const ui = { stepKernel: /FILE_NAME\('[^']*','[^']*',\('[^']*'\),\(''\),'cad-text','cad-text \(OpenCascade\)'/.test(stepTxt), stepAscii: !/[^\x00-\x7f]/.test(stepTxt), stlSolid: /^solid /.test(stlTxt) };
  console.log('ui download:', JSON.stringify(ui));
  if (!ui.stepKernel || !ui.stepAscii || !ui.stlSolid) errs.push('ダウンロードの STEP / STL が想定と違います');
  console.log('ERRORS', errs);
  await b.close();
})();
