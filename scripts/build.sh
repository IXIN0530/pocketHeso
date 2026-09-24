#!/usr/bin/env bash
# 型検査 → lint → web のビルド
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
cd "$ROOT"
run_logged typecheck pnpm typecheck
run_logged lint pnpm lint
run_logged build pnpm build
