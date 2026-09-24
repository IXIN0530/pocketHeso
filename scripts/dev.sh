#!/usr/bin/env bash
# 開発サーバー（同一 LAN の実機から開けるよう --host）
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm --filter @ph/web dev --host "$@"
