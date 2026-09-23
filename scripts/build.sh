#!/usr/bin/env bash
# usage: scripts/build.sh [sim|device]
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
cd "$ROOT"
MODE="${1:-sim}"
[[ -d PocketHeso.xcodeproj ]] || "$ROOT/scripts/gen.sh" >/dev/null

COMMON=(-project PocketHeso.xcodeproj -scheme PocketHeso -configuration Debug
        -derivedDataPath build/DerivedData)
case "$MODE" in
  sim)
    run_logged build-sim xcodebuild "${COMMON[@]}" \
      -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build ;;
  device)
    run_logged build-device xcodebuild "${COMMON[@]}" \
      -destination 'generic/platform=iOS' -allowProvisioningUpdates build ;;
  *) echo "usage: $0 [sim|device]"; exit 2 ;;
esac
