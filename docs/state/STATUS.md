# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P0 → `docs/plan/P0-bootstrap.md`
- Last done: 設計転換（iOS ネイティブ → React/TS PWA＋ショートカット＋行動報酬型の放置経済。D-010〜D-017）
- Next: P0-T1
- Owner hint: Claude Code

## Blockers
- なし

## Notes（最新3件まで）
- 旧 spec/plan/platform-limits は docs/archive/native-v1/ に退避。Swift コードはタグ native-v1 に保存し、P0-T1 で main 系から削除する。作業ブランチは dev。
- P0-T3/T4 は実機（iPhone のショートカット・位置情報）が必要。手順を提示して人間に依頼すること。
- ショートカットの iCloud リンクは人間が作成して resources/shortcut/README.md に記入（P4-T2 / P8-T2）。
