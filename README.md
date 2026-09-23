# PocketHeso

通知欄（ロック画面 / 通知センター）に常駐し、歩数に応じて自動で打ち続けるパチンコシミュレーター。
iOS 26 / iPhone 16e 向け。App Store 非公開。

- エージェント向け入口: `AGENTS.md`（OpenCode）/ `CLAUDE.md`（Claude Code）
- 進捗: `docs/state/STATUS.md`
- 計画: `docs/plan/`、仕様: `docs/spec/`、参照: `docs/ref/`

## セットアップ（人間向け）
1. macOS 26 + Xcode 26.3 以降、`brew install xcodegen`
2. `project.yml` 先頭の `BUNDLE_PREFIX` と `DEVELOPMENT_TEAM` を自分の値に変更
3. `scripts/gen.sh && open PocketHeso.xcodeproj`
