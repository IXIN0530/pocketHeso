#!/usr/bin/env bash
# usage: DEVICE=<devicectl の識別子> scripts/install.sh   （未指定なら接続中の最初の iPhone）
# 事前に scripts/build.sh device を実行しておくこと。
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
cd "$ROOT"
APP="build/DerivedData/Build/Products/Debug-iphoneos/PocketHeso.app"
[[ -d "$APP" ]] || { echo "not found: $APP (run scripts/build.sh device)"; exit 1; }

if [[ -z "${DEVICE:-}" ]]; then
  JSON="$ROOT/logs/devices.json"
  xcrun devicectl list devices --json-output "$JSON" >/dev/null
  DEVICE="$(/usr/bin/python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))["result"]["devices"]
d=[x for x in d if x.get("hardwareProperties",{}).get("platform")=="iOS"]
print(d[0]["identifier"] if d else "")' "$JSON")"
  [[ -n "$DEVICE" ]] || { echo "iOS device not found"; exit 1; }
fi
run_logged install xcrun devicectl device install app --device "$DEVICE" "$APP"
