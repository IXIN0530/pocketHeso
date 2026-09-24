#!/usr/bin/env bash
# pachisim（Atlas 生成・統計・経済試算）
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm --silent --filter @ph/pachisim start "$@"
