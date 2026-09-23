#!/usr/bin/env bash
# usage: scripts/sim.sh <pachisim args>
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
cd "$ROOT"
run_logged sim swift run --package-path Packages/PachinkoCore -c release pachisim "$@"
