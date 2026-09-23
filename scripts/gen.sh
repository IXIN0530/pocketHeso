#!/usr/bin/env bash
# Xcode プロジェクト生成（.xcodeproj と各 Info.plist は生成物）
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
cd "$ROOT"
run_logged gen xcodegen generate --spec project.yml
