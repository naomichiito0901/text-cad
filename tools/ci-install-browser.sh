#!/bin/bash
# CI で、Playwright のブラウザと依存パッケージを入れる。 使い方: tools/ci-install-browser.sh <chromium|firefox|webkit>
#
# GitHub のランナーには Microsoft の apt ソース (Edge・Azure CLI など) が入っていて、packages.microsoft.com が
# 一時的に 403 を返すことがある。 すると、Playwright の依存パッケージの導入 (apt-get update) が止まり、
# テストを始める前に CI 全体が失敗して公開も止まる。 このテストでは Microsoft のパッケージを使わないので、
# そのソースを除いたうえで、導入を最大 3 回まで再試行する。
set -u
browser="$1"
dir="${APT_SOURCES_DIR:-/etc/apt/sources.list.d}"
SUDO=""
[ "$(id -u)" = 0 ] || SUDO="sudo"

if [ -d "$dir" ]; then
  for f in $(grep -l "packages.microsoft.com" "$dir"/* 2>/dev/null); do
    echo "不要な apt ソースを除外します: $f"
    $SUDO rm -f "$f"
  done
fi

exec bash "$(dirname "$0")/retry.sh" 3 npx playwright install --with-deps "$browser"
