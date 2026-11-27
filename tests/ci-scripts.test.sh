#!/bin/bash
# CI の補助スクリプト (tools/retry.sh, tools/ci-install-browser.sh) の確認。 偽の npx を使うので、ネットワークは使わない。
# 確認する内容: 一時的な失敗は再試行して成功する / 最後まで失敗したら失敗で終わる / Microsoft の apt ソースだけを除く
cd "$(dirname "$0")/.." || exit 1
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/apt"
cat > "$T/bin/npx" <<EOF
#!/bin/bash
n=\$(cat "$T/count" 2>/dev/null || echo 0); n=\$((n+1)); echo \$n > "$T/count"
echo "  (偽の npx: \$n 回目: \$*)"
[ "\$n" -ge "\${FAIL_UNTIL:-3}" ]
EOF
chmod +x "$T/bin/npx"
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: 期待 $3 / 実際 $2"; fail=1; fi; }

reset() {
  echo 0 > "$T/count"
  printf 'deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n' > "$T/apt/microsoft-prod.list"
  printf 'deb http://archive.ubuntu.com/ubuntu noble main\n' > "$T/apt/ubuntu.list"
}

reset
PATH="$T/bin:$PATH" APT_SOURCES_DIR="$T/apt" RETRY_WAIT=0 FAIL_UNTIL=3 bash tools/ci-install-browser.sh webkit > "$T/out1" 2>&1
check "2 回失敗しても、3 回目で成功する (終了コード)" "$?" "0"
check "  試行回数" "$(cat "$T/count")" "3"
check "  Microsoft の apt ソースを除く" "$([ -e "$T/apt/microsoft-prod.list" ] && echo 残る || echo 除外)" "除外"
check "  それ以外の apt ソースは残す" "$([ -e "$T/apt/ubuntu.list" ] && echo 残る || echo 除外)" "残る"

reset
PATH="$T/bin:$PATH" APT_SOURCES_DIR="$T/apt" RETRY_WAIT=0 FAIL_UNTIL=99 bash tools/ci-install-browser.sh firefox > "$T/out2" 2>&1
check "3 回とも失敗したら、失敗で終わる (終了コード 0 でない)" "$([ $? -ne 0 ] && echo 失敗 || echo 成功)" "失敗"
check "  試行回数 (3 回で止まる)" "$(cat "$T/count")" "3"

# retry.sh: 成功するコマンドは 1 回だけ実行する
echo 0 > "$T/count"
RETRY_WAIT=0 bash tools/retry.sh 3 bash -c "n=\$(cat '$T/count'); echo \$((n+1)) > '$T/count'"
check "retry.sh: 成功するコマンドは 1 回だけ実行" "$(cat "$T/count")" "1"

[ $fail = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $fail
