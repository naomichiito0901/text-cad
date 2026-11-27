#!/bin/bash
# 全回帰テストを順に実行する。 使い方: bash tests/run_all.sh
#   CAD_OUT : 出力先 (既定 /tmp/cad-out)
#   BROWSER : chromium | firefox | webkit (既定 chromium)。Python の出力検証は chromium のときだけ実行
#             (STEP/STL/IFC/DXF の生成はブラウザに依存しない JS のため)。 VALIDATE=1 で強制実行
#   PYTHON  : Python の実行ファイル (未指定なら .venv/bin/python、無ければ python3)
# 前提: npm ci と python3 build.py 済み (画面テストは dist-offline/ のオフライン版を開く)。 Python 検証には tests/requirements.txt のパッケージが必要
cd "$(dirname "$0")" || exit 1
export CAD_OUT="${CAD_OUT:-/tmp/cad-out}"; mkdir -p "$CAD_OUT"
export BROWSER="${BROWSER:-chromium}"
if [ -n "$PYTHON" ]; then PY="$PYTHON"; elif [ -x ../.venv/bin/python ]; then PY=../.venv/bin/python; else PY=python3; fi
fail=0
echo "browser: $BROWSER"
for t in test2 test5 test6 test7 test8 test9 test10 test11 test14 test15 test16 test17 test18 test19; do
  node $t.js > "$CAD_OUT/$t.log" 2>&1 || { echo "FAIL(node) $t"; tail -25 "$CAD_OUT/$t.log" | cut -c1-300; fail=1; continue; }
  if grep -q "ERRORS \[\]" "$CAD_OUT/$t.log"; then echo "ok   $t"; else echo "FAIL $t (ブラウザエラーあり: $CAD_OUT/$t.log)"; tail -25 "$CAD_OUT/$t.log" | cut -c1-400 | sed 's/^/    | /'; fail=1; fi
done
if [ "$BROWSER" = chromium ] || [ -n "$VALIDATE" ]; then
  for v in validate1 validate2 validate3 validate4 validate5 validate6; do
    out=$($PY -I $v.py 2>&1 | tail -1)
    if [ "$out" = "ALL OK: True" ]; then echo "ok   $v"; else echo "FAIL $v: $out"; fail=1; fi
  done
else
  echo "skip validate1-4 (BROWSER=$BROWSER。出力検証は chromium で実行)"
fi
[ $fail = 0 ] && echo "ALL PASS" || echo "SOME FAILED"; exit $fail
