// 画面テストのブラウザ起動。 環境変数 BROWSER=chromium|firefox|webkit で切り替える (既定 chromium)
const pw = require('playwright');

const name = process.env.BROWSER || 'chromium';
if (!pw[name]) throw new Error(`BROWSER=${name} は未対応です (chromium / firefox / webkit)`);

// Chromium は GPU の無い環境でも WebGL が動くようソフトウェア描画にする
// Firefox は GPU の無い CI で WebGL を作れないため、ソフトウェア描画 (Mesa llvmpipe) を強制する
const opts = {
  chromium: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  firefox: {
    env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' },
    firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false, 'webgl.forbid-software': false, 'webgl.enable-webgl2': true, 'gfx.webrender.software': true },
  },
  webkit: {},
}[name];

exports.name = name;
exports.launch = () => pw[name].launch(opts);
