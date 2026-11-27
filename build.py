#!/usr/bin/env python3
"""src/ と node_modules のライブラリを 1 枚の dist/index.html に結合する (オフラインで動作)。

使い方:
    npm ci
    python3 build.py [node_modules のパス]
出力: dist/index.html, dist/LICENSE, dist/THIRD_PARTY_LICENSES
"""
import pathlib
import shutil
import sys

root = pathlib.Path(__file__).resolve().parent
nm = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "node_modules"


def read(p):
    return pathlib.Path(p).read_text(encoding="utf-8")


licenses = read(root / "LICENSE").strip() + "\n\n" + "=" * 60 + "\n\n" + read(root / "THIRD_PARTY_LICENSES").strip() + "\n"
parts = {
    "/*__LICENSES__*/": licenses,
    "/*__JSYAML__*/": read(nm / "js-yaml/dist/js-yaml.min.js"),
    "/*__THREE__*/": read(nm / "three/build/three.min.js"),
    "/*__JSCAD__*/": read(nm / "@jscad/modeling/dist/jscad-modeling.min.js"),
    "/*__APP__*/": "(function () {\n'use strict';\n" + "\n".join(
        read(root / "src" / f) for f in ("core.js", "workflow.js", "arch.js", "section.js", "ui.js")
    ) + "\n})();\n",
}
html = read(root / "src/template.html")
for key, body in parts.items():
    if "</script" in body.lower():
        sys.exit(f"{key}: </script を含むためインライン化できません")
    html = html.replace(key, body)

dist = root / "dist"
dist.mkdir(exist_ok=True)
out = dist / "index.html"
out.write_text(html, encoding="utf-8")
for f in ("LICENSE", "THIRD_PARTY_LICENSES"):
    shutil.copy(root / f, dist / f)
print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
