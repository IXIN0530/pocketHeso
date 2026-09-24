# PocketHeso

良い行動（歩数・ワークアウト・ジムや公園でのトレーニング）をすると「営業時間」がもらえ、
その間パチンコホールの役物が回って玉が増えていく放置ゲーム。玉は強化にも、パチンコを打つ（抽選）のにも使える。
React + TypeScript の PWA。iPhone ではホーム画面に追加し、ヘルスケアの運動記録は iOS ショートカット経由で受け取る
（Apple Developer Program 不要）。

- エージェント向け入口: `AGENTS.md`（OpenCode / 共通）/ `CLAUDE.md`（Claude Code）/ `GEMINI.md`（agy）
- 進捗: `docs/state/STATUS.md`、計画: `docs/plan/`、仕様: `docs/spec/`、参照: `docs/ref/`
- 旧 iOS ネイティブ版の設計: `docs/archive/native-v1/`

## セットアップ（人間向け, P0-T1 以降）
1. Node 22 LTS、`corepack enable`（pnpm）
2. `pnpm install && scripts/dev.sh`
