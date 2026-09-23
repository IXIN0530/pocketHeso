#!/usr/bin/env bash
# usage: scripts/test.sh [core|all]
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
cd "$ROOT"
MODE="${1:-core}"
run_logged test-core swift test --package-path Packages/PachinkoCore
if [[ "$MODE" == "all" ]]; then
  [[ -d PocketHeso.xcodeproj ]] || "$ROOT/scripts/gen.sh" >/dev/null
  run_logged test-app xcodebuild -project PocketHeso.xcodeproj -scheme PocketHeso \
    -derivedDataPath build/DerivedData \
    -destination "platform=iOS Simulator,name=${SIM_NAME:-iPhone 17e}" CODE_SIGNING_ALLOWED=NO test
elif [[ "$MODE" != "core" ]]; then
  echo "usage: $0 [core|all]"; exit 2
fi
