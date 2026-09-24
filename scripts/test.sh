#!/usr/bin/env bash
# core: Core と claims（Node, 決定論テスト含む）/ all: 全パッケージ
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
cd "$ROOT"
case "${1:-core}" in
  core) run_logged test-core pnpm --filter @ph/core --filter @ph/claims test ;;
  all)  run_logged test-all pnpm test ;;
  *)    echo "usage: scripts/test.sh [core|all]" >&2; exit 2 ;;
esac
