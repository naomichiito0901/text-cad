# patches/ — 第三者ソフトウェアへの補正

このアプリが同梱するソフトウェアのうち、**補正を加えているのは OpenCascade の起動用 JavaScript だけ**です。
**WebAssembly 本体 (`replicad_single.wasm`) は一切改変せず**、gzip で圧縮して同梱します(展開すると元と同一)。

## occt-glue.patch

| 項目 | 内容 |
|---|---|
| 対象 | `replicad-opencascadejs` **1.2.1** の `dist/replicad_single.js` (Emscripten が生成する起動用 JS) |
| 元ファイルの入手先 | npm: https://www.npmjs.com/package/replicad-opencascadejs/v/1.2.1 (`npm ci` で `node_modules/` に入る) |
| 元ファイルの SHA-256 | `465b68c209b416396857fad30a6e33e7f5407907373cfe240c194af6d80c4a1d` |
| 元のソース | https://github.com/sgenoud/replicad (`packages/replicad-opencascadejs`)。 OCCT: https://github.com/Open-Cascade-SAS/OCCT |
| ライセンス | LGPL-2.1-only (`THIRD_PARTY_LICENSES` を参照) |
| 差分 | `occt-glue.patch` (unified diff。 `patch` コマンドで適用できる) |

### 変更点 (2 つだけ)

1. **`import.meta.url` を固定の文字列 `"https://kernel.invalid/"` にする** (3 か所)。
   Blob から読み込むと `new URL(".", import.meta.url)` が不正になり、起動に失敗するため。
   WASM は呼び出し側から `instantiateWasm` で渡す(後述)ので、この URL から何かを取得することは無い。
2. **`export default Module;` を `globalThis.__OCModule=Module;` にする**。
   ES モジュールではない通常のスクリプトにして、Web Worker 内で `eval` できるようにする。
   (Blob の ES モジュールの `import()` に頼らないので、Firefox・WebKit・`file://` でも同じ動作になる)

### 補正ではないもの

`instantiateWasm` は、起動用 JS を書き換えずに、呼び出し側 (`src/kernel-worker.js`) が Emscripten の標準の
オプションとして渡すものです。 同梱した WASM のバイナリを直接インスタンス化させ、外部への取得をさせないために使います。

## 再生成・適用

```bash
python3 tools/make_patches.py   # 元ファイルの SHA-256 を確認し、occt-glue.patch を作り直す
python3 build.py                # ビルド時に patch コマンドで適用する (SHA-256 が違えば止まる)
```

`replicad-opencascadejs` のバージョンを上げるときは、`tools/make_patches.py` と `build.py` の SHA-256 と、
この README の表を更新し、補正がまだ必要かを確認してください。
