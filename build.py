#!/usr/bin/env python3
"""src/ と node_modules のライブラリから、配布物を 2 通り作る (同じソース・同じ計算エンジン)。

  dist/          GitHub Pages 用。 index.html + kernel/ (WASM は gzip で別ファイル) + オフライン版の zip
  dist-offline/  フォルダ配布 (オフライン) 用。 index.html + kernel-data.js (2 ファイル構成)。 ダブルクリックで動く

使い方:
    npm ci
    python3 build.py [node_modules のパス]

計算エンジン (OpenCascade WASM) は外部 CDN を使わず、必ず同梱する。
起動用 JS への補正は patches/occt-glue.patch (WASM 本体は改変しない)。 詳しくは patches/README.md。
"""
import base64
import gzip
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parent
nm = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "node_modules"

GLUE_SHA256 = "465b68c209b416396857fad30a6e33e7f5407907373cfe240c194af6d80c4a1d"  # replicad-opencascadejs 1.2.1


def read(p):
    return pathlib.Path(p).read_text(encoding="utf-8")


def die(msg):
    sys.exit(f"build.py: {msg}")


# ---- 計算エンジン (OpenCascade WASM + replicad) --------------------------------
occt = nm / "replicad-opencascadejs/dist"
glue_src = occt / "replicad_single.js"
if hashlib.sha256(glue_src.read_bytes()).hexdigest() != GLUE_SHA256:
    die("replicad-opencascadejs の起動用 JS が想定 (1.2.1) と違います。 patches/README.md を見て補正を作り直してください")

# 補正 (patches/occt-glue.patch) を適用する。 `patch` コマンドを使う (macOS / Linux 標準)
tmp = root / ".glue-patched.tmp"
subprocess.run(["patch", "-s", "-o", str(tmp), str(glue_src), str(root / "patches/occt-glue.patch")], check=True)
glue = tmp.read_text(encoding="utf-8")
tmp.unlink()
if "import.meta" in glue or "export default" in glue:
    die("補正後の起動用 JS に import.meta / export default が残っています")

replicad = (nm / "replicad/dist/replicad.umd.cjs").read_text(encoding="utf-8")
wasm_gz = gzip.compress((occt / "replicad_single.wasm").read_bytes(), 9, mtime=0)  # 決定的な出力にする

# ---- アプリ本体 -----------------------------------------------------------------
licenses = read(root / "LICENSE").strip() + "\n\n" + "=" * 60 + "\n\n" + read(root / "THIRD_PARTY_LICENSES").strip() + "\n"
app = "(function () {\n'use strict';\n" + "\n".join(
    read(root / "src" / f) for f in ("core.js", "workflow.js", "arch.js", "section.js", "kernel.js", "ui.js")
) + "\n})();\n"
parts = {
    "/*__LICENSES__*/": licenses,
    "/*__KERNEL_WORKER__*/": read(root / "src/kernel-worker.js"),
    "/*__JSYAML__*/": read(nm / "js-yaml/dist/js-yaml.min.js"),
    "/*__THREE__*/": read(nm / "three/build/three.min.js"),
    "/*__JSCAD__*/": read(nm / "@jscad/modeling/dist/jscad-modeling.min.js"),
    "/*__APP__*/": app,
}
for key, body in parts.items():
    if "</script" in body.lower():
        die(f"{key}: </script を含むためインライン化できません")


def build_html(mode):
    html = read(root / "src/template.html").replace("__KERNEL_MODE__", mode)
    for key, body in parts.items():
        html = html.replace(key, body)
    return html


def write(path, data):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_bytes(data)


def fresh(d):
    if d.exists():
        shutil.rmtree(d)
    d.mkdir()


def copy_licenses(d):
    for f in ("LICENSE", "THIRD_PARTY_LICENSES"):
        shutil.copy(root / f, d / f)


# ---- フォルダ配布 (オフライン) ----------------------------------------------------
off = root / "dist-offline"
fresh(off)
write(off / "index.html", build_html("offline"))
write(
    off / "kernel-data.js",
    "window.__KERNEL_DATA=" + json.dumps(
        {"wasmGzB64": base64.b64encode(wasm_gz).decode("ascii"), "glue": glue, "replicad": replicad}, ensure_ascii=False
    ) + ";\n",
)
copy_licenses(off)
write(off / "はじめに.txt", (
    "テキスト → CAD (オフライン版)\n\n"
    "index.html をブラウザで開くと使えます (ダブルクリックで開けます)。\n"
    "kernel-data.js は計算エンジン (OpenCascade) です。 index.html と同じフォルダに置いてください。\n"
    "インターネット接続は不要です。 入力した内容は外部に送信されません。\n\n"
    "ライセンスは LICENSE と THIRD_PARTY_LICENSES を参照してください。\n"
))

# ---- Web 公開 (GitHub Pages) ------------------------------------------------------
dist = root / "dist"
fresh(dist)
write(dist / "index.html", build_html("web"))
write(dist / "kernel/occt.wasm.gz", wasm_gz)
write(dist / "kernel/occt.js", glue)
write(dist / "kernel/replicad.js", replicad)
copy_licenses(dist)

# オフライン版の zip (Pages からもダウンロードできるようにする)。 決定的な出力にするため日付は固定
zpath = dist / "text-cad-offline.zip"
with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(off.iterdir()):
        zi = zipfile.ZipInfo(f"text-cad-offline/{f.name}", date_time=(2026, 1, 1, 0, 0, 0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, f.read_bytes())

for d in (dist, off):
    total = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
    print(f"wrote {d.name}/ ({total / 1048576:.1f} MB)")
print(f"  index.html {(dist / 'index.html').stat().st_size // 1024} KB / occt.wasm.gz {len(wasm_gz) / 1048576:.1f} MB / zip {zpath.stat().st_size / 1048576:.1f} MB")
