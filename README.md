# テキスト→CAD (cad-text-app)

書式付きテキスト(YAML)を入力すると、機械部品・建築・電気回路の 2D/3D CAD と、図面・STEP/STL/IFC/DXF を生成するブラウザアプリです。
処理はすべてブラウザ内で完結し、入力データは外部に送信しません。

## ビルド

`dist/index.html` は `src/` とライブラリ(`package.json` でバージョン固定)から `build.py` で組み立てます(単一ファイル、約 1.1 MB)。`dist/` は Git 管理外です。

```bash
npm ci                # js-yaml 4.1.0 / three r149 / @jscad/modeling 2.12.3 / playwright を取得
python3 build.py      # dist/index.html, dist/LICENSE, dist/THIRD_PARTY_LICENSES を生成
```

生成した `dist/index.html` はダブルクリックでそのまま開けます(ネット接続は不要)。

## 公開 (GitHub Pages)

`main` への push で、GitHub Actions (`.github/workflows/pages.yml`) が「ビルド → 全テスト → Pages へ公開」を自動で実行します。テストが 1 つでも失敗すると公開されません。
初回のみ、リポジトリの Settings → Pages → Source を「GitHub Actions」にしてください。

## ライセンス

- 本体: MIT (`LICENSE`)。
- 埋め込んでいるライブラリ: `THIRD_PARTY_LICENSES` に著作権表示とライセンス全文を掲載しています(画面右上の「情報」と、納品 zip の `LICENSES.txt` にも同じ内容が入ります)。
- 埋め込むライブラリを増減したときは、`tools/gen_licenses.py` の `LIBS` を更新して `python3 tools/gen_licenses.py` を実行し、`THIRD_PARTY_LICENSES` を作り直します。

## テスト (tests/)

画面操作テスト (Playwright / Chromium) と、出力ファイルを OpenCASCADE・ezdxf・ifcopenshell で読み直す検証から成ります。
**正解データのファイルは保存しません。** 検証は、理論式との比較(体積など)と、読み込みの成否で行います。

### 前提

- Node.js と、`npm ci` で入る `playwright`(Chromium は `npx playwright install chromium` で取得)
- Python 3 と `pip install -r tests/requirements.txt`(`cadquery-ocp`、`ifcopenshell`、`ezdxf`、`numpy`。venv 推奨)
- 先に `python3 build.py` で `dist/index.html` を作っておくこと

### 再実行手順

出力先を環境変数 `CAD_OUT` で指定します(未指定なら `/tmp/cad-out`)。先に node のテストを実行すると、検証用の STEP/STL/zip が `CAD_OUT` に書き出されます。続いて Python の検証がそれを読み込みます。

```bash
cd tests
export CAD_OUT=/tmp/cad-out
mkdir -p $CAD_OUT
for t in test2 test5 test6 test7 test8 test9 test10 test11 test14 test15 test16 test17; do
  node $t.js > $CAD_OUT/$t.log 2>&1; echo "$t: $(grep -c 'ERRORS \[\]' $CAD_OUT/$t.log)"   # 1 なら合格
done
for v in validate1 validate2 validate3 validate4; do
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
| validate4.py | 納品 zip 内の DXF (audit)・STEP (有効性・体積)・IFC (要素数)・LICENSES.txt の同梱を検査 |

### 合格基準

- 画面テスト: ブラウザのエラーが 0 件 (`ERRORS []`)。寸法の記入数や検図の指摘が想定どおりであること。
- 検証: STEP が OpenCASCADE で有効な立体として読め、体積が理論値と 0.01% 以内で一致すること。STL は辺の対応が全て取れていて(水密)、体積差が 0.5% 以内であること。

今後カーネルを切り替えたあとも、読み込みの成否に加え、理論式による体積・面積の照合を続けます。

## 今後の課題

- 形状サンプルの図面で、引出し線「φ10」と「φ8 H7」が交差する。隠れ線処理(HLR)の切り替え後に直す。
