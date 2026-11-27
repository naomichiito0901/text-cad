#!/usr/bin/env python3
"""OpenCascade の起動用 JS (Emscripten が出力するグルー) への補正を作り、差分を patches/ に書き出す。

補正は WASM 本体には一切触れない。 起動用 JS の次の 2 点だけを変える:
  1. `import.meta.url` を固定の文字列にする。
     Blob URL から読み込むと `new URL(".", import.meta.url)` が不正になるため。 WASM は
     `instantiateWasm` (Module の引数) で渡すので、この URL から何かを取得することは無い。
  2. `export default Module;` を `globalThis.__OCModule = Module;` にする。
     これで ES モジュールではない通常のスクリプトとして、Web Worker 内で実行できる
     (Blob の ES モジュールを import() できない環境を避けるため)。

使い方: python3 tools/make_patches.py   (node_modules が必要。 npm ci 済みであること)
元ファイルの SHA-256 が想定と違えば止まる (バージョンを上げたら patches/README.md も更新する)。
"""
import hashlib
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent.parent
src = root / "node_modules/replicad-opencascadejs/dist/replicad_single.js"
out = root / "patches/occt-glue.patch"

EXPECTED_SHA256 = "465b68c209b416396857fad30a6e33e7f5407907373cfe240c194af6d80c4a1d"  # replicad-opencascadejs 1.2.1
RULES = [
    ("import.meta.url", '"https://kernel.invalid/"'),
    ("export default Module;", "globalThis.__OCModule=Module;"),
]


def patched(text):
    for old, new in RULES:
        if old not in text:
            sys.exit(f"補正の対象が見つかりません: {old}")
        text = text.replace(old, new)
    if "import.meta" in text or "export default" in text:
        sys.exit("補正後も import.meta / export default が残っています")
    return text


if __name__ == "__main__":
    data = src.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    print("original sha256:", sha)
    if sha != EXPECTED_SHA256:
        sys.exit("元ファイルの SHA-256 が想定と違います。 replicad-opencascadejs のバージョンを確認してください")
    new = root / ".patched-tmp.js"
    new.write_text(patched(data.decode("utf-8")), encoding="utf-8")
    try:
        d = subprocess.run(
            ["diff", "-u", "--label", "a/replicad_single.js", "--label", "b/occt.js", str(src), str(new)],
            capture_output=True, text=True,
        )
        out.parent.mkdir(exist_ok=True)
        out.write_text(d.stdout, encoding="utf-8")
        print(f"wrote {out} ({len(d.stdout)} bytes)")
    finally:
        new.unlink()
