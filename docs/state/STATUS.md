# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P0 → `docs/plan/P0-bootstrap.md`
- Last done: P0-T2 の実装（manifest・仮アイコン・injectManifest の SW・更新通知・起動状態表示）。実機確認待ち
- Next: P0-T2 の実機確認 → OK なら main へ ff マージ → P0-T3
- Owner hint: Claude Code

## Blockers
- なし

## Notes（最新3件まで）
- P0-T2: dev とタグ native-v1 を push 済み。origin/main は旧 Swift 状態（59a8ed9）のため Vercel 本番は未稼働。プレビューで実機確認後に main を ff する。
- P0-T1: TypeScript は 6.0.3 に固定（D-020）。Vite 8 / Vitest 5 / ESLint 10。pnpm の esbuild ビルドスクリプトは未承認のままでビルド可。
- P0-T3/T4 は実機（iPhone のショートカット・位置情報）が必要。手順を提示して人間に依頼すること。
