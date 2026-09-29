# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P8 完了（v1.0.0 リリース済み）→ 残りは P8-T7（任意・Web Push）と P7 再開（人間の指示待ち）
- Last done: P8-T6（正式版リリース: main=bc86b75 にff・v1.0.0タグ・push済み。Blockers持ち越しで人間の「リリースしてよい」指示により実施）
- Next: 人間の指示待ち（本番確認OK → P8-T7 か P7-T11再開）
- Owner hint: 人間（本番の4項目確認）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- 本番確認の人間OK待ち（P8-T6 の Accept: Debugタブ無し・計測ログ無し/v1.0.0/初回案内・ホーム画面+ショートカット・セーブ引継ぎ）
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P8-T6]: dev で build・test all・release-check 通過 → dev push → main に ff マージ (bc86b75)・v1.0.0 タグ・push。本 STATUS 更新で dev が +1。担当は Muse Spark 推奨だが Muse Spark が実行
- [P8-T8 レビュー修正]: 旧 v3 スナップショットを読み Core restore でレート移行・打つレートも丸め・オート蓄積は1発分で頭打ち・Engine 経路のテスト4本追加（D-092）。golden 不変。test core・build・test all 通過、dev push 済み。既に v4 で保存し直した端末には効かない
- [P8-T8]: 単価 unit=rate×ref×8・ボーナス廃止・レート1/2/4/10/20/40/100・旧400/1000→100移行・オートは生産×share/unit・webに1発◯玉表示。test core・build・test all通過、dev push済み。**実機待ち（人間）**: 1パチ1分で生産約13分減・当たりで数時間増。担当はClaude Code推奨だがMuse Sparkが実行
(End of file - total 18 lines)
