# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P0 → `docs/plan/P0-bootstrap.md`
- Last done: P0-T1（旧 Swift 一式を削除＝タグ native-v1、pnpm workspace・ESLint 決定論ルール・scripts。build/test all 通過）
- Next: P0-T2
- Owner hint: Claude Code

## Blockers
- なし

## Notes（最新3件まで）
- 作業ブランチは dev（D-019）。dev・タグ native-v1 はまだ origin に push していない。P0-T2 の Pages デプロイ前に人間の了承を得て push する。
- P0-T1: TypeScript は 6.0.3 に固定（D-020）。Vite 8 / Vitest 5 / ESLint 10。pnpm の esbuild ビルドスクリプトは未承認のままでビルド可。
- P0-T3/T4 は実機（iPhone のショートカット・位置情報）が必要。手順を提示して人間に依頼すること。
