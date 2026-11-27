// 干渉チェック (計算エンジンの共通部分の体積) を、手計算できる重なりの体積 (理論値) と照合する。
//   合格: 干渉する組が理論どおり / 体積が理論値と 1e-5 以内 / 画面 (工程 3) が同じ結果を使っている
// (旧実装 = 3D の標本抽出との比較は、PR で行い、一致を確認して削除した)
const { launch } = require('./browser');
const { interference } = require('./cases');

(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: 1300, height: 800 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../dist-offline/index.html'));
  await p.click('[data-step="3"]');

  const pct = (x) => (x * 100).toFixed(2).padStart(7) + '%';
  console.log(`${'case'.padEnd(15)} ${'組'.padEnd(22)} ${'体積'.padStart(9)} ${'理論'.padStart(9)} ${'誤差'.padStart(8)}  判定`);
  let allOk = true;
  for (const [k, c] of Object.entries(interference)) {
    if (c.btn) {
      await p.click(c.btn);
      if (c.replace) await p.fill('#editor', (await p.inputValue('#editor')).replace(...c.replace));
    } else await p.fill('#editor', c.yaml);
    await p.waitForTimeout(900);
    const err = (await p.textContent('#error')) || '';
    if (err && !/WebGL/.test(err)) { errs.push(`[${k}] ${err}`); allOk = false; continue; }
    const r = await p.evaluate(async () => {
      const wf = window.__cad.wf;
      const model = window.__cad.kernelModelOf(wf.solids);
      const nw = await window.__cad.kernel.call('interfere', { model });
      const names = wf.solids.map((s) => s.name);
      return {
        nw: nw.hits.map((h) => ({ key: `${names[h.i]}|${names[h.j]}`, volume: h.volume, dz: h.dz })),
        ui: { state: wf.interference.state, hits: wf.interference.hits.map((h) => `${h.a}|${h.b}`) },
      };
    });
    const keys = (a) => a.map((h) => h.key).sort().join(',');
    const th = c.theory;
    const samePairs = keys(r.nw) === Object.keys(th).sort().join(',');
    const uiOk = r.ui.state === 'done' && r.ui.hits.slice().sort().join(',') === keys(r.nw);
    let ok = samePairs && uiOk;
    const rows = r.nw.length ? r.nw : [{ key: '(干渉なし)', volume: 0 }];
    for (const h of rows) {
      const t = th[h.key], eNew = t ? Math.abs(h.volume - t) / t : 0;
      if (t && eNew > 1e-5) ok = false;
      console.log(`${k.padEnd(15)} ${h.key.padEnd(22)} ${h.volume.toFixed(2).padStart(9)} ${(t ? t.toFixed(2) : '-').padStart(9)} ${(t ? pct(eNew) : '').padStart(8)}  ${ok ? 'OK' : 'NG'}`);
    }
    if (!ok) { allOk = false; errs.push(`[${k}] 理論値と合いません: 結果=${keys(r.nw)} 理論=${Object.keys(th)} 画面=${r.ui.state}`); }
  }
  console.log('all ok:', allOk);
  console.log('ERRORS', errs);
  await b.close();
})();
