#!/usr/bin/env python3
"""node_modules の LICENSE から THIRD_PARTY_LICENSES を生成する。

配布物に埋め込む第三者ソフトウェアを増減したら、このスクリプトの LIBS を更新して再実行する。
使い方: python3 tools/gen_licenses.py
"""
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
nm = root / "node_modules"

# (パッケージ名, 用途, 入手先)
LIBS = [
    ("js-yaml", "YAML の解析", "https://github.com/nodeca/js-yaml"),
    ("three", "3D 表示 (three.js)", "https://github.com/mrdoob/three.js"),
    ("@jscad/modeling", "3D ソリッドの演算 (JSCAD)", "https://github.com/jscad/OpenJSCAD.org"),
]

out = [
    "THIRD PARTY LICENSES / 第三者ソフトウェアのライセンス",
    "=" * 60,
    "",
    "このアプリは、下記のソフトウェアを配布物(index.html など)に埋め込んで使用しています。",
    "各ソフトウェアの著作権表示とライセンス全文を以下に掲載します。",
    "",
]
for name, use, url in LIBS:
    pkg = json.loads((nm / name / "package.json").read_text(encoding="utf-8"))
    lic = (nm / name / "LICENSE").read_text(encoding="utf-8").strip()
    out += [
        "-" * 60,
        f"{name} {pkg['version']}  ({pkg.get('license', '')})",
        f"用途: {use}",
        f"入手先: {url}",
        "-" * 60,
        "",
        lic,
        "",
    ]
(root / "THIRD_PARTY_LICENSES").write_text("\n".join(out) + "\n", encoding="utf-8")
print("wrote THIRD_PARTY_LICENSES")
