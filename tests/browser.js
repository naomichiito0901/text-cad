// 画面テストのブラウザ起動。 環境変数 BROWSER=chromium|firefox|webkit で切り替える (既定 chromium)
const pw = require('playwright');

const name = process.env.BROWSER || 'chromium';
if (!pw[name]) throw new Error(`BROWSER=${name} は未対応です (chromium / firefox / webkit)`);

// Chromium は GPU の無い環境でも WebGL が動くようソフトウェア描画にする
const opts = name === 'chromium' ? { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : {};

exports.name = name;
exports.launch = () => pw[name].launch(opts);
