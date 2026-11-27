// 画面テストのブラウザ起動。 環境変数 BROWSER=chromium|firefox|webkit で切り替える (既定 chromium)
const pw = require('playwright');

const name = process.env.BROWSER || 'chromium';
if (!pw[name]) throw new Error(`BROWSER=${name} は未対応です (chromium / firefox / webkit)`);

// Chromium は GPU の無い環境でも WebGL が動くようソフトウェア描画にする
const opts = {
  chromium: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  firefox: {},
  webkit: {},
}[name];

// GPU の無い CI の Firefox は WebGL を作れない (ソフトウェア描画の設定でも不可)。
// 3D 表示そのものは chromium (ソフトウェア描画) と webkit で検証し、Firefox では
// WebGL 作成失敗のエラーだけを無視して、WebGL に依らない機能 (図面・検図・出力など) を検証する。
const ignoreWebgl = (name === 'firefox' || !!process.env.IGNORE_WEBGL) && !process.env.STRICT_WEBGL;
const isWebglMsg = (t) => /WebGL/i.test(String(t));

// launch({ waitKernel: false }) で、読み込み中の状態を観察するテスト (test18) 用に、次の 2 つの補助を無効にできる
//  - goto のあと、計算エンジンの読み込み (ready / error) を待つ
//  - waitForTimeout のあと、干渉の計算 (非同期) の完了を待つ。 画面の更新が非同期になっても、
//    固定の待ち時間で判定している既存のテストが不安定にならないようにするため
function patchPage(page, helpers) {
  if (ignoreWebgl) {
    const on = page.on.bind(page);
    page.on = (ev, h) => {
      if (ev === 'console') return on(ev, (m) => { if (m.type() === 'error' && isWebglMsg(m.text())) return; h(m); });
      if (ev === 'pageerror') return on(ev, (e) => { if (isWebglMsg(e && e.message)) return; h(e); });
      return on(ev, h);
    };
  }
  if (helpers) {
    const goto = page.goto.bind(page);
    page.goto = async (...a) => {
      const r = await goto(...a);
      await page.waitForFunction(() => window.__cad && window.__cad.kernel && ['ready', 'error'].includes(window.__cad.kernel.state.phase), null, { timeout: 120000 }).catch(() => {});
      return r;
    };
    const wait = page.waitForTimeout.bind(page);
    page.waitForTimeout = async (ms) => {
      await wait(ms);
      await page.evaluate(() => (window.__cad && window.__cad.settled ? window.__cad.settled() : null)).catch(() => {});
    };
  }
  return page;
}

function patchBrowser(b, helpers) {
  const newContext = b.newContext.bind(b);
  b.newContext = async (...a) => {
    const c = await newContext(...a);
    const newPage = c.newPage.bind(c);
    c.newPage = async (...x) => patchPage(await newPage(...x), helpers);
    return c;
  };
  const newPage = b.newPage.bind(b);
  b.newPage = async (...a) => patchPage(await newPage(...a), helpers);
  return b;
}

exports.name = name;
exports.launch = async ({ waitKernel = true } = {}) => patchBrowser(await pw[name].launch(opts), waitKernel);
