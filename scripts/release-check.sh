#!/usr/bin/env bash
# 正式版バンドルに開発用表示が含まれないことを確認（P8-T1, D-087）
# PH_RELEASE=1 で web をビルド → 目印が無ければ OK → 通常ビルドで目印が有ること（dev に残っていること）を確認
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
cd "$ROOT"

MARKERS=('spike:' 'Grant 注入' '演出プレビュー' '計測ログ' 'ph.spike.')
DIST="$ROOT/apps/web/dist"

run_logged build-release env PH_RELEASE=1 pnpm --filter @ph/web build

fail=0
for m in "${MARKERS[@]}"; do
  if grep -r -F -q "$m" "$DIST"; then
    echo "❌ release-check FAILED: 正式版に目印が残っている: $m"
    grep -r -F -l "$m" "$DIST" | head -n 20
    fail=1
  fi
done
if [[ $fail -ne 0 ]]; then
  echo "❌ release-check FAILED (log: logs/build-release.log)"
  exit 1
fi
echo "✅ release-check release OK (正式版に目印なし)"

run_logged build-dev pnpm --filter @ph/web build

if grep -r -F -q 'Grant 注入' "$DIST"; then
  echo "✅ release-check dev OK (dev に Grant 注入あり)"
else
  echo "❌ release-check FAILED: dev に Grant 注入が無い"
  exit 1
fi
echo "✅ release-check OK (log: logs/build-release.log, logs/build-dev.log)"
