// 計算エンジン (OpenCascade) の STEP・STL の出力。 形状のケース (cases.js) とアプリのサンプルについて、
// k_<ケース>.{step,stl,json} に書き出す。 体積・表面積・面数・有効性の一覧と理論値の照合は validate6.py が行う。
// あわせて、画面の STEP・STL ダウンロードがカーネルの出力であること、
// 計算エンジンが使えないとき (Web 版を file:// で開いた場合) の挙動を確認する。
const { launch } = require('./browser');
const fs = require('fs');
const path = require('path');
const { cases, samples } = require('./cases');

const S = path.join(process.env.CAD_OUT || '/tmp/cad-out', '/');
fs.mkdirSync(S, { recursive: true });

(async () => {
  const b = await launch();
  const errs = [];
  const mkPage = async () => {
    const p = await (await b.newContext({ viewport: { width: 1300, height: 800 }, acceptDownloads: true })).newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    return p;
  };

  /* ---- 1. 計算エンジンの出力 (オフライン版) ---- */
  const p = await mkPage();
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
        const t0 = performance.now();
        const nw = await window.__cad.kernelExport(wf, 'k.step');
        return { nw, ms: Math.round(performance.now() - t0), n: wf.solids.length };
      } catch (e) { return { error: String(e.message || e) }; }
    });
    if (out.error) { errs.push(`[${k}] 計算エンジンの出力に失敗: ${out.error}`); continue; }
    fs.writeFileSync(S + `k_${k}.step`, out.nw.step);
    fs.writeFileSync(S + `k_${k}.stl`, out.nw.stl);
    fs.writeFileSync(S + `k_${k}.json`, JSON.stringify(out.nw.solids));
    summary.push(`${k}: ${out.n} 立体 / ${out.ms} ms / valid=${out.nw.solids.every((s) => s.valid)}`);
  }
  console.log(summary.join('\n'));

  // 画面の操作でも、計算エンジンの STEP / STL が出ること。
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

  /* ---- 2. 計算エンジンが使えないとき (Web 版を file:// で開く) ---- */
  const q = await mkPage();
  await q.goto('file://' + path.resolve(__dirname, '../dist/index.html'));
  await q.waitForFunction(() => window.__cad && window.__cad.kernel.state.phase === 'error', null, { timeout: 30000 });
  await q.click('[data-step="6"]'); await q.waitForTimeout(400);
  // STEP: 作れない。 エラーを表示し、ファイルは出ない
  let gotFile = false;
  q.once('download', () => { gotFile = true; });
  await q.click('[data-act="f-exp"][data-id="step"]'); await q.waitForTimeout(800);
  const stepMsg = await q.textContent('#error');
  const stepDownloaded = gotFile; // この後の STL のダウンロードで立つ前に控える
  // STL: 旧実装 (メッシュ) で出る
  let stlOld = '';
  try {
    const [dl] = await Promise.all([q.waitForEvent('download', { timeout: 10000 }), q.click('[data-act="f-exp"][data-id="stl"]')]);
    stlOld = fs.readFileSync(await dl.path(), 'utf8').slice(0, 20);
  } catch (e) { stlOld = 'download なし'; }
  // 納品 zip: 3D モデルを作れないので、版の確定 (改訂履歴への記録) をする前に止まる
  await q.click('[data-step="5"]'); await q.waitForTimeout(300);
  await q.fill('#appr-name', '検図者A'); if (await q.$('#appr-ack')) await q.check('#appr-ack');
  await q.click('[data-act="approve"]'); await q.waitForTimeout(300);
  await q.click('[data-step="6"]'); await q.waitForTimeout(300);
  const histBefore = await q.evaluate(() => window.__cad.store.history.length);
  let zipFile = false;
  q.once('download', () => { zipFile = true; });
  await q.click('[data-act="zip"]'); await q.waitForTimeout(800);
  const zipMsg = await q.textContent('#error');
  const histAfter = await q.evaluate(() => window.__cad.store.history.length);
  const fb = {
    stepBlocked: !stepDownloaded && /計算エンジンで作ります/.test(stepMsg || ''),
    stlFallback: /^solid cad_text/.test(stlOld),
    zipBlocked: !zipFile && /納品パッケージを作成できません/.test(zipMsg || '') && histAfter === histBefore,
  };
  console.log('kernel unavailable:', JSON.stringify(fb), JSON.stringify({ stepMsg, zipMsg, histBefore, histAfter }));
  if (!fb.stepBlocked || !fb.stlFallback || !fb.zipBlocked) errs.push('計算エンジンが使えないときの挙動が想定と違います');

  console.log('ERRORS', errs);
  await b.close();
})();
