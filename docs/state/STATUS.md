# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P8 完了（v1.0.0 リリース済み）→ 残りは P8-T7（任意・Web Push）と P7 再開（人間の指示待ち）
- Last done: P8-T6 修正（Vercel Production でのテスト失敗を修正・dev のみ）
- Next: 人間の指示で修正を main に ff → 本番再デプロイ確認 → P8-T7 か P7-T11再開
- Owner hint: 人間（本番の4項目確認）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- 本番確認の人間OK待ち（P8-T6 の Accept: Debugタブ無し・計測ログ無し/v1.0.0/初回案内・ホーム画面+ショートカット・セーブ引継ぎ）
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P8-T6 修正]: Vercel Production で web テスト1件失敗（clock.test が `__DEV_TOOLS__=true` 前提。VERCEL_ENV=production で false）→ 正式版は倍率1を期待するよう修正。VERCEL_ENV=production でも test 通過、build・test all 通過、dev push 済み。**main への反映は人間の指示待ち**
- [P8-T6]: dev で build・test all・release-check 通過 → dev push → main に ff マージ (bc86b75)・v1.0.0 タグ・push。本 STATUS 更新で dev が +1。担当は Muse Spark 推奨だが Muse Spark が実行
- [P8-T8 レビュー修正]: 旧 v3 スナップショットを読み Core restore でレート移行・打つレートも丸め・オート蓄積は1発分で頭打ち・Engine 経路のテスト4本追加（D-092）。golden 不変。test core・build・test all 通過、dev push 済み。既に v4 で保存し直した端末には効かない
(End of file - total 18 lines)
