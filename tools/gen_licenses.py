#!/usr/bin/env python3
"""node_modules の LICENSE から THIRD_PARTY_LICENSES を生成する。

配布物に埋め込む第三者ソフトウェアを増減したら、このスクリプトの LIBS を更新して再実行する。
使い方: python3 tools/gen_licenses.py   (npm ci 済みであること)
"""
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
nm = root / "node_modules"

# (パッケージ名, 表示名, 用途, 入手先, 補足 (任意))
LIBS = [
    ("js-yaml", "js-yaml", "YAML の解析", "https://github.com/nodeca/js-yaml", ""),
    ("three", "three.js", "3D 表示", "https://github.com/mrdoob/three.js", ""),
    ("@jscad/modeling", "JSCAD (@jscad/modeling)", "3D ソリッドの演算 (旧実装)", "https://github.com/jscad/OpenJSCAD.org", ""),
    ("replicad", "replicad", "形状計算・STEP/STL 出力 (OpenCascade を扱うライブラリ)", "https://github.com/sgenoud/replicad",
     "下記の flatbush と opentype.js は、replicad の配布ファイル (kernel/replicad.js) に含まれています。"),
    ("flatbush", "flatbush (replicad に同梱)", "空間インデックス", "https://github.com/mourner/flatbush", ""),
    ("opentype.js", "opentype.js (replicad に同梱)", "フォントの読み込み", "https://github.com/opentypejs/opentype.js", ""),
    ("replicad-opencascadejs", "Open CASCADE Technology (OCCT) の WebAssembly ビルド (replicad-opencascadejs)",
     "形状計算 (ブーリアン演算・フィレット・断面・隠線処理・STEP 出力)", "https://github.com/Open-Cascade-SAS/OCCT",
     "OCCT は Open CASCADE SAS の著作物です。 replicad-opencascadejs は LGPL-2.1-only として配布されています。\n"
     "本アプリが使う WebAssembly (occt.wasm.gz、オフライン版では kernel-data.js の中) は、replicad-opencascadejs の\n"
     "配布物をそのまま (改変せずに) 同梱したものです。 アプリ本体とは別のファイル/データとして配布しています。\n"
     "WebAssembly の起動用 JavaScript (Emscripten が生成) だけに、patches/ にある補正を加えています。\n"
     "OCCT のソース: https://github.com/Open-Cascade-SAS/OCCT\n"
     "WebAssembly のビルド設定: https://github.com/sgenoud/replicad (packages/replicad-opencascadejs)"),
]

out = [
    "THIRD PARTY LICENSES / 第三者ソフトウェアのライセンス",
    "=" * 60,
    "",
    "このアプリは、下記のソフトウェアを配布物 (index.html、kernel/、kernel-data.js など) に含めて使用しています。",
    "各ソフトウェアの著作権表示とライセンス全文を以下に掲載します。",
    "",
]
for name, title, use, url, note in LIBS:
    pkg = json.loads((nm / name / "package.json").read_text(encoding="utf-8"))
    lic = (nm / name / "LICENSE").read_text(encoding="utf-8").strip()
    out += [
        "-" * 60,
        f"{title} {pkg['version']}  ({pkg.get('license', '')})",
        f"用途: {use}",
        f"入手先: {url}",
    ]
    if note:
        out += ["", note]
    out += ["-" * 60, "", lic, ""]
(root / "THIRD_PARTY_LICENSES").write_text("\n".join(out) + "\n", encoding="utf-8")
print("wrote THIRD_PARTY_LICENSES")
