# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P0 → `docs/plan/P0-bootstrap.md`
- Last done: P0-T2（PWA 化。iPhone でホーム画面追加・standalone 起動・機内モード起動を手動確認済み。main へ ff 済み）
- Next: P0-T3
- Owner hint: Claude Code

## Blockers
- なし

## Notes（最新3件まで）
- P0-T2: Vercel のプレビュー保護（Vercel Authentication）は無効化済み。有効だと iOS がアイコンを取れず頭文字表示になる。機内モード起動時の「機内モードを解除」は iOS の案内で、起動自体は成功。
- P0-T1: TypeScript は 6.0.3 に固定（D-020）。Vite 8 / Vitest 5 / ESLint 10。pnpm の esbuild ビルドスクリプトは未承認のままでビルド可。
- P0-T3/T4 は実機（iPhone のショートカット・位置情報）が必要。手順を提示して人間に依頼すること。
