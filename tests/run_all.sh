#!/bin/bash
# 全回帰テストを順に実行する。 使い方: tests/run_all.sh  (出力先は CAD_OUT、既定 /tmp/cad-out)
# 前提: node + playwright、Python に cadquery-ocp / ifcopenshell / ezdxf / numpy (PYTHON= で指定可)
cd "$(dirname "$0")"
export CAD_OUT="${CAD_OUT:-/tmp/cad-out}"; mkdir -p "$CAD_OUT"
PY="${PYTHON:-python3}"
fail=0
for t in test2 test5 test6 test7 test8 test9 test10 test11 test14 test15 test16 test17; do
  node $t.js > "$CAD_OUT/$t.log" 2>&1 || { echo "FAIL(node) $t"; fail=1; continue; }
  if grep -q "ERRORS \[\]" "$CAD_OUT/$t.log"; then echo "ok   $t"; else echo "FAIL $t (ブラウザエラーあり: $CAD_OUT/$t.log)"; fail=1; fi
done
for v in validate1 validate2 validate3 validate4; do
  out=$($PY -I $v.py 2>&1 | tail -1)
  if [ "$out" = "ALL OK: True" ]; then echo "ok   $v"; else echo "FAIL $v: $out"; fail=1; fi
done
[ $fail = 0 ] && echo "ALL PASS" || echo "SOME FAILED"; exit $fail
