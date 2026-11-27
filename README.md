# テキスト→CAD (cad-text-app)

書式付きテキスト(YAML)を入力すると、機械部品・建築・電気回路の 2D/3D CAD と、図面・STEP/STL/IFC/DXF を生成するブラウザアプリです。
処理はすべてブラウザ内で完結し、入力データは外部に送信しません。

## ビルド

`build.py` が、同じソースと同じ計算エンジンから、配布物を 2 通り作ります(`dist/`、`dist-offline/` は Git 管理外)。

```bash
npm ci                # js-yaml / three / @jscad/modeling / replicad / replicad-opencascadejs / playwright を取得
python3 build.py
```

| 出力 | 用途 | 構成 |
|---|---|---|
| `dist/` | GitHub Pages | `index.html`(約 1.1 MB)+ `kernel/`(`occt.wasm.gz` 約 6.9 MB、`occt.js`、`replicad.js`)+ `text-cad-offline.zip` |
| `dist-offline/` | フォルダ配布(オフライン)| `index.html` + `kernel-data.js`(約 10 MB)の 2 ファイル。ダブルクリックで開ける。ネット接続は不要 |

`text-cad-offline.zip` は `dist-offline/` の内容を固めたもので、Pages の「情報」からダウンロードできます。

## 計算エンジン

形状計算は OpenCascade(WebAssembly)+ replicad で行い、**Web Worker** で動かします。
WASM は外部 CDN を使わず、必ず同梱します(Web 版は `kernel/` を、オフライン版は `kernel-data.js` を読む)。
読み込み中(数秒)も YAML は編集でき、画面右上に「計算エンジン: 読み込み中 NN%」→「準備完了」と表示します。
`file://` で開く Web 版では `fetch` が使えないため、計算エンジンは読み込まれません(案内を出します。旧実装で動作は続きます)。

**3D モデルの STEP・STL は、計算エンジンの出力です**(機械部品。建築の IFC・STL は旧実装のまま)。
- **部品ごとに 1 つの立体に融合**して出力します(組立では `inst` が同じ立体のまとまり、単品では全体で 1 つの部品)。板の上面に載せたボスのように、面で接しているだけの立体もつなげます。組立の部品どうしは融合しません。離れていて融合できない立体が部品にあるときは、別の立体のまま出力し、検図に警告(承認は可能)「部品「○○」に離れた立体があります」を出します。
- **STEP の形式**は、案件情報の `project:` の `step_format` で指定します(`AP242`(標準)または `AP214`。省略は AP242)。工程 1 に表示され、変えるとファイルの内容が変わるため承認は失効します。
- 日本語の名前は `\X2\…\X0\` に直します。ヘッダ(FILE_NAME)には案件の作図者などを入れます。
- 融合に失敗したときは、STEP を作れない理由(部品名つき)を表示し、STL は旧方式で出力します。納品 zip は、版の確定の前に止まります。
干渉チェック(部品どうしの共通部分の体積)も計算エンジンで求めます。読み込み中・計算中は工程 3 に「確認中」と出し、確認できるまで(計算エンジンが使えないときも)承認できません。

出力ボタン・納品 zip は、計算エンジンが読み込み中なら待ちます。計算エンジンが使えないとき(Web 版を `file://` で開いた場合など)は、STEP は作れずエラーを表示し、STL は旧実装(JSCAD のメッシュ。建築の STL と共通)で出力します。納品 zip は、3D モデルを作れないときは、版の確定(改訂履歴への記録)をする前に止まります。

起動用 JavaScript への補正は `patches/` に差分で残しています(WASM 本体は改変しません)。詳しくは `patches/README.md`。

## 公開 (GitHub Pages)

`main` への push で、GitHub Actions (`.github/workflows/pages.yml`) が「ビルド → 全テスト(Chromium・Firefox・WebKit)→ Pages へ公開」を自動で実行します。テストが 1 つでも失敗すると公開されません。
初回のみ、リポジトリの Settings → Pages → Source を「GitHub Actions」にしてください。

依存の取得(`npm ci`・`pip install`・Playwright のブラウザ)は、配布元の一時的な障害(apt の 403 など)で止まらないよう、最大 3 回まで再試行します(`tools/retry.sh`)。ブラウザの導入では、テストに不要な Microsoft の apt ソース(packages.microsoft.com)も除きます(`tools/ci-install-browser.sh`)。**テストの実行は再試行しません**。テストが本当に失敗したときは、そのまま失敗にして、公開しません。

## ライセンス

- 本体: MIT (`LICENSE`)。
- 埋め込んでいるライブラリ: `THIRD_PARTY_LICENSES` に著作権表示とライセンス全文を掲載しています(画面右上の「情報」と、納品 zip の `LICENSES.txt` にも同じ内容が入ります)。
- 埋め込むライブラリを増減したときは、`tools/gen_licenses.py` の `LIBS` を更新して `python3 tools/gen_licenses.py` を実行し、`THIRD_PARTY_LICENSES` を作り直します。

## テスト (tests/)

画面操作テスト (Playwright / Chromium・Firefox・WebKit) と、出力ファイルを OpenCASCADE・ezdxf・ifcopenshell で読み直す検証から成ります。
**正解データのファイルは保存しません。** 検証は、理論式との比較(体積など)と、読み込みの成否で行います。

### 前提

- Node.js(24 系)と、`npm ci` で入る `playwright`
- Python 3.12 と `pip install -r tests/requirements.txt`(`cadquery-ocp`、`ifcopenshell`、`ezdxf`、`numpy`)。リポジトリ直下の `.venv` に作ると、`run_all.sh` が自動で使います
- 先に `python3 build.py` で `dist/` と `dist-offline/` を作っておくこと

### 手元の環境構築 (macOS / Homebrew)

```bash
brew install node python@3.12
python3.12 -m venv .venv
.venv/bin/pip install -r tests/requirements.txt
npm ci
npx playwright install chromium firefox webkit   # ブラウザ本体を取得 (初回のみ)
python3 build.py
bash tests/run_all.sh
```

### ブラウザの切り替え

画面テストは、環境変数 `BROWSER=chromium|firefox|webkit`(既定 chromium)で切り替えます。
STEP/STL/IFC/DXF の出力検証(`validate1〜4.py`)は、ブラウザに依存しないため chromium のときだけ実行します(`VALIDATE=1` で他のブラウザでも実行)。
GitHub Actions では、3 つのブラウザで画面テストを実行します。

**WebGL:** GitHub Actions の Firefox は GPU が無く、WebGL を使えません。アプリは WebGL が使えるかを先に確かめ、使えない環境では 3D 表示の代わりに案内を出します(コンソールにエラーは出しません)。画面テストは WebGL のエラーを**無視しません**(3 つのブラウザとも)。3D 表示そのものは Chromium(ソフトウェア描画)と WebKit で検証し、WebGL が使えない環境での動作は、`getContext('webgl')` を無効にして再現する `test21.js` で 3 つのブラウザとも確認します。全テストを WebGL の無い環境で実行するには `NO_WEBGL=1` を付けます。

```bash
BROWSER=firefox bash tests/run_all.sh
```

### 再実行手順

出力先を環境変数 `CAD_OUT` で指定します(未指定なら `/tmp/cad-out`)。先に node のテストを実行すると、検証用の STEP/STL/zip が `CAD_OUT` に書き出されます。続いて Python の検証がそれを読み込みます。

```bash
cd tests
export CAD_OUT=/tmp/cad-out
mkdir -p $CAD_OUT
for t in test2 test5 test6 test7 test8 test9 test10 test11 test14 test15 test16 test17 test18; do
  node $t.js > $CAD_OUT/$t.log 2>&1; echo "$t: $(grep -c 'ERRORS \[\]' $CAD_OUT/$t.log)"   # 1 なら合格
done
for v in validate1 validate2 validate3 validate4 validate5; do
  python3 -I $v.py | tail -1                                                              # ALL OK: True なら合格
done
```

`tests/run_all.sh` に同じ内容をまとめています(`bash tests/run_all.sh`)。

### テスト一覧

| ファイル | 内容 |
|---|---|
| test2.js | 機械・単品: 6工程、承認、納品zip、改訂での承認失効、干渉検出、最小YAML |
| test5.js | 機械・組立: 部品図、断面図、太いピンの干渉、浮き部品、異常入力 |
| test6.js | 建築: 6工程、平面図・立面図、検図 |
| test7.js | 建築: IFC 出力、承認、納品zip、L字プラン |
| test8.js | 建築の異常系: 壁の重複、囲い漏れ、採光、扉の開き、寸法なし、不正入力 |
| test9.js | 形状拡充の STEP/STL 出力 (角R・面取り・止まり穴・座ぐり・皿穴・円柱面取り・組合せ) |
| test10.js | 形状サンプルの 6 工程 |
| test11.js | 座ぐりへのボルト干渉、入力エラーのメッセージ(約 20 ケース) |
| test14.js | ねじ穴・斜め穴・長穴の STEP/STL 出力 |
| test15.js | 穴サンプルの図面・断面図 |
| test16.js | 円柱フィレットの STEP/STL 出力と入力エラー |
| test17.js | 形状サンプルの図面・断面図 |
| validate1.py | test9 の STEP/STL を理論体積と照合 (STEP 有効性・体積・STL 水密) |
| validate2.py | test14 の STEP/STL を理論体積と照合 |
| validate3.py | test16 の STEP/STL を理論体積と照合 |
| test18.js | 計算エンジンの読み込み(オフライン版 file://・Web 版 HTTP・読み込み中の編集・Web 版を file:// で開いた場合)と、Worker での計算 |
| validate5.py | test18 が書き出したカーネル出力の STEP・STL を OpenCascade で読み直し、体積・表面積を理論式と照合 |
| test19.js | 計算エンジンの STEP・STL を全ケース(形状ケースとサンプル)で書き出す。画面の STEP・STL ダウンロードがカーネル出力であること、計算エンジンが使えないとき(STEP は作れない・STL は旧方式・納品 zip は止まる)の挙動を確認 |
| validate6.py | test19 の出力(AP242 と AP214)を OpenCascade で読み直し、有効性・立体数・面数・体積・表面積・STL の水密性を一覧にし、理論式(体積・表面積)と照合。立体の数が部品の数と一致すること、融合の前後で体積が変わらないことも確認 |
| test20.js | 干渉チェック(計算エンジンの共通部分の体積)を、手計算できる重なりの体積(箱どうし・ピンと穴・円柱の交わり・座ぐりのボルトなど)と照合。画面(工程 3)が同じ結果を使うことも確認 |
| test21.js | WebGL が使えない環境(`getContext('webgl')` を無効にして再現)で、3D 表示の案内(使えるものが分かる文言)・STEP/STL 出力・干渉結果・図面・検図と承認・納品 zip・建築の IFC が使えること。コンソールのエラーも許さない |
| ci-scripts.test.sh | CI の補助スクリプト(`tools/retry.sh`、`tools/ci-install-browser.sh`)の確認。偽の `npx` で、一時的な失敗は再試行して成功し、最後まで失敗すれば失敗になること、Microsoft の apt ソースだけを除くことを確かめる |
| test22.js | 部品ごとの融合(接している・重なっている・離れている・組立)、干渉チェックが融合しても変わらないこと、離れた立体の警告(承認は可能)、`step_format`(AP214・AP242・省略・不正値・工程 1 の表示・形式を変えると承認が失効)、融合に失敗したときの理由の表示 |
| test23.js | 断面図: 断面の面積を、立体の記述だけから高さごとに足し上げた理論値と照合 (全ケース・サンプルの約 230 断面)、ハッチ線の量が断面積と合うこと、計算エンジンが使えないときの案内と検図 (E06) での停止 |
| validate7.py | test22 の STEP を OpenCascade で読み直し、立体の数、融合の前後の体積、表面積を理論式と照合 |
| validate4.py | 納品 zip 内の DXF (audit)・STEP (有効性・体積)・IFC (要素数)・LICENSES.txt の同梱を検査 |

### 合格基準

- 画面テスト: ブラウザのエラーが 0 件 (`ERRORS []`)。寸法の記入数や検図の指摘が想定どおりであること。
- 検証: STEP が OpenCASCADE で有効な立体として読め、体積が理論値と 0.01% 以内で一致すること。STL は辺の対応が全て取れていて(水密)、体積差が 0.5% 以内であること。

今後カーネルを切り替えたあとも、読み込みの成否に加え、理論式による体積・面積の照合を続けます。

## 今後の課題

- 形状サンプルの図面で、引出し線「φ10」と「φ8 H7」が交差する。隠れ線処理(HLR)の切り替え後に直す。
