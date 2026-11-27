// 部品ごとの融合と、STEP の形式 (step_format)、融合に失敗したときの理由の表示。
//  1. 融合のケース (cases.js の fusion) の STEP を f_<ケース>.{step,json} に書き出す (validate7.py が OpenCascade で読み直して照合)
//  2. 干渉チェックの結果が、融合しても変わらないこと (立体ごとの重なりの合計 = 部品ごと (融合した形) の重なり)
//  3. 離れた立体がある部品の警告 (W23。承認はできる)
//  4. step_format: AP214 の指定 / 不正な値のエラー / 工程 1 の表示 / 形式を変えると承認が失効する
//  5. 融合に失敗したとき、STEP を作れない理由が出る (STL は旧方式、納品 zip は止まる)
const { launch } = require('./browser');
const fs = require('fs');
const path = require('path');
const { fusion, interference } = require('./cases');

const S = path.join(process.env.CAD_OUT || '/tmp/cad-out', '/');
fs.mkdirSync(S, { recursive: true });

(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1300, height: 800 }, acceptDownloads: true })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' ' + info : ''}`); if (!ok) errs.push(name); };
  const dl = async (sel) => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click(sel)]); return fs.readFileSync(await d.path(), 'utf8'); };
  await p.goto('file://' + path.resolve(__dirname, '../dist-offline/index.html'));
  await p.click('[data-step="2"]');
  const initial = await p.inputValue('#editor');
  const setYaml = async (c) => {
    if (c.btn) { await p.click(c.btn); if (c.replace) await p.fill('#editor', (await p.inputValue('#editor')).replace(...c.replace)); } else await p.fill('#editor', c.yaml || initial);
    await p.waitForTimeout(900);
  };

  /* ---- 1・3. 融合のケース ---- */
  for (const [k, c] of Object.entries(fusion)) {
    await setYaml(c);
    const err = (await p.textContent('#error')) || '';
    if (err) { errs.push(`[${k}] ${err}`); continue; }
    const out = await p.evaluate(async () => {
      const wf = window.__cad.wf;
      const r = await window.__cad.kernelExport(wf, 'f.step');
      const w23 = wf.rules.find((x) => x.id === 'W23');
      return { step: r.step, parts: r.parts, w23: w23 ? { ok: w23.ok, detail: w23.detail } : null };
    });
    fs.writeFileSync(S + `f_${k}.step`, out.step);
    fs.writeFileSync(S + `f_${k}.json`, JSON.stringify({ parts: out.parts, expect: c, warn: out.w23 }));
    const solids = out.parts.reduce((t, x) => t + x.solids, 0);
    check(`融合 ${k}: 部品 ${out.parts.length} / 立体 ${solids}`, out.parts.length === c.parts && solids === c.solids);
    check(`融合 ${k}: 離れた立体の警告 (W23)`, out.w23 && out.w23.ok === !c.warn, out.w23 && !out.w23.ok ? `(${out.w23.detail})` : '');
    if (c.warn) check(`融合 ${k}: 警告の文言`, /部品「a\+b」に離れた立体があります/.test(out.w23.detail));
  }

  /* ---- 2. 干渉チェックの結果が変わらない ---- */
  for (const k of ['bolt-hit', 'asm-fat-pin', 'bolt-ok']) {
    await setYaml(interference[k]);
    const r = await p.evaluate(async () => {
      const wf = window.__cad.wf, model = window.__cad.kernelModelOf(wf.solids), names = wf.solids.map((s) => s.name);
      const bySolid = await window.__cad.kernel.call('interfere', { model });
      const byPart = await window.__cad.kernel.call('interfere', { model, byPart: true });
      const tot = {};
      for (const h of bySolid.hits) { const key = [names[h.i].split('/')[0], names[h.j].split('/')[0]].join('|'); tot[key] = (tot[key] || 0) + h.volume; }
      const part = {};
      for (const h of byPart.hits) part[`${h.a}|${h.b}`] = h.volume;
      return { tot, part, ui: wf.interference.hits.length };
    });
    const keys = Object.keys(r.tot).sort().join(','), pkeys = Object.keys(r.part).sort().join(',');
    const same = keys === pkeys && Object.keys(r.tot).every((q) => Math.abs(r.tot[q] - r.part[q]) / r.tot[q] < 1e-6);
    check(`干渉 ${k}: 立体ごと = 部品ごと (融合した形)`, same, `(${Object.entries(r.tot).map(([q, v]) => `${q}=${v.toFixed(2)}`).join(', ') || '干渉なし'})`);
  }

  /* ---- 3'. 警告があっても承認はできる ---- */
  await setYaml(fusion.disjoint);
  await p.click('[data-step="5"]'); await p.waitForTimeout(500);
  const p5 = (await p.textContent('#panel')) || '';
  check('検図: 離れた立体の警告が出る (承認の妨げにならない)', /部品「a\+b」に離れた立体があります/.test(p5));
  await p.fill('#appr-name', '検図者A'); if (await p.$('#appr-ack')) await p.check('#appr-ack');
  check('検図: 警告だけなら承認できる', !(await p.isDisabled('[data-act="approve"]')));

  /* ---- 4. step_format ---- */
  await setYaml({ yaml: null });
  const withFormat = (v) => initial.replace(/^(  step_format:).*$/m, `$1 ${v}`);
  check('サンプルに step_format の行がある', /^  step_format: AP242/m.test(initial));
  await p.fill('#editor', withFormat('AP214')); await p.waitForTimeout(900);
  await p.click('[data-step="1"]'); await p.waitForTimeout(400);
  check('工程1: STEP の形式が表示される', /STEP の形式/.test((await p.textContent('#panel')) || '') && /AP214/.test((await p.textContent('#panel')) || ''));
  await p.click('[data-step="2"]'); await p.waitForTimeout(400);
  await p.click('[data-step="6"]'); await p.waitForTimeout(400);
  const s214 = await dl('[data-act="f-exp"][data-id="step"]');
  check('AP214 の指定で、AP214 の STEP が出る', /AUTOMOTIVE_DESIGN \{ 1 0 10303 214 1 1 1 1 \}/.test(s214.replace(/\s+/g, ' ')) && !/AP242/.test(s214));
  await p.fill('#editor', withFormat('AP242')); await p.waitForTimeout(900);
  const s242 = await dl('[data-act="f-exp"][data-id="step"]');
  check('AP242 の指定で、AP242 の STEP が出る', /AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF/.test(s242.replace(/\s+/g, ' ')));
  await p.fill('#editor', initial.replace(/^  step_format:.*\n/m, '')); await p.waitForTimeout(900);
  const sDef = await dl('[data-act="f-exp"][data-id="step"]');
  check('step_format を省略すると AP242', /AP242_MANAGED/.test(sDef.replace(/\s+/g, ' ')));
  await p.fill('#editor', withFormat('AP999')); await p.waitForTimeout(900);
  const bad = (await p.textContent('#error')) || '';
  check('不正な step_format はエラー', /step_format は AP242 または AP214/.test(bad), `(${bad.slice(0, 70)})`);

  // 形式を変えると、承認が失効する
  await p.fill('#editor', withFormat('AP242')); await p.waitForTimeout(900);
  await p.click('[data-step="5"]'); await p.waitForTimeout(400);
  await p.fill('#appr-name', '検図者A'); if (await p.$('#appr-ack')) await p.check('#appr-ack');
  await p.click('[data-act="approve"]'); await p.waitForTimeout(400);
  check('承認できる', /承認済み/.test((await p.textContent('#panel')) || ''));
  await p.fill('#editor', withFormat('AP214')); await p.waitForTimeout(900);
  await p.click('[data-step="5"]'); await p.waitForTimeout(400);
  check('step_format を変えると承認が失効する', !/承認済み/.test((await p.textContent('#panel')) || ''));

  /* ---- 5. 融合に失敗したときの理由 (テスト用に失敗させる) ---- */
  await p.fill('#editor', withFormat('AP242')); await p.waitForTimeout(900);
  await p.click('[data-step="5"]'); await p.waitForTimeout(300);
  if (await p.$('#appr-name')) { // 内容が以前の承認と同じ (AP242 に戻した) ときは、承認が再び有効になっている
    await p.fill('#appr-name', '検図者A'); if (await p.$('#appr-ack')) await p.check('#appr-ack');
    await p.click('[data-act="approve"]'); await p.waitForTimeout(400);
  }
  await p.click('[data-step="6"]'); await p.waitForTimeout(300);
  await p.evaluate(() => { window.__kernelTest = { failFuse: true }; });
  let got = false;
  p.once('download', () => { got = true; });
  await p.click('[data-act="f-exp"][data-id="step"]'); await p.waitForTimeout(1200);
  const stepErr = (await p.textContent('#error')) || '';
  check('融合に失敗: STEP は出ず、部品名つきで理由が出る', !got && /STEP\) を作れません/.test(stepErr) && /部品「base\+boss」の立体を融合できませんでした/.test(stepErr), `(${stepErr.slice(0, 90)})`);
  const stl = await dl('[data-act="f-exp"][data-id="stl"]');
  const stlErr = (await p.textContent('#error')) || '';
  check('融合に失敗: STL は旧方式で出て、理由も出る', /^solid /.test(stl) && /融合できませんでした/.test(stlErr));
  const histBefore = await p.evaluate(() => window.__cad.store.history.length);
  let zip = false;
  p.once('download', () => { zip = true; });
  await p.click('[data-act="zip"]'); await p.waitForTimeout(1200);
  const zipErr = (await p.textContent('#error')) || '', histAfter = await p.evaluate(() => window.__cad.store.history.length);
  check('融合に失敗: 納品 zip は作られず、版も確定しない', !zip && /納品パッケージは作成しませんでした/.test(zipErr) && /融合できませんでした/.test(zipErr) && histAfter === histBefore);
  await p.evaluate(() => { window.__kernelTest = undefined; });

  console.log('ERRORS', errs);
  await b.close();
})();
