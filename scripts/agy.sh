#!/usr/bin/env bash
# agy はリポジトリルートを --add-dir で渡さないと .agents/・AGENTS.md・GEMINI.md を読まない場合がある
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec agy --add-dir "$ROOT" "$@"
