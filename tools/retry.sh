#!/bin/bash
# コマンドを、失敗したら待ってから再試行する (ネットワークやパッケージ配布元の一時的な障害に備える)。
# 使い方: tools/retry.sh <回数> <コマンド> [引数...]    例: tools/retry.sh 3 npm ci
# 待ち時間は 20 秒、40 秒…と延ばす。 最後まで失敗したら、最後の失敗の終了コードで終わる。
# テストの実行には使わない (テストが本当に失敗したときは、再試行せずに失敗にする)。
n="$1"; shift
i=1
while true; do
  "$@" && exit 0
  code=$?
  if [ "$i" -ge "$n" ]; then
    echo "retry.sh: $n 回試しましたが失敗しました: $*" >&2
    exit "$code"
  fi
  wait_s=$((i * ${RETRY_WAIT:-20}))
  echo "retry.sh: 失敗しました (試行 $i/$n)。 ${wait_s} 秒後に再試行します: $*" >&2
  sleep "$wait_s"
  i=$((i + 1))
done
