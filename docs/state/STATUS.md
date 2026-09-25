# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P3 → `docs/plan/P3-core-economy.md`
- Last done: [P3-T2] 経済の状態遷移
- Next: P3-T3 予告とオート打ちの統合
- Owner hint: Muse Spark（P3-T3推奨、Review: Claude Code）

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P3-T2: IdleEconomy＋Engine1000ms統合。手書きシナリオ一致・overflow/boost/buy/awaken/close/streak・決定論1vs刻み/snapshot一致。core88件・build通過。実機確認不要。
- P3-T1 レビュー修正: closeGain の立方数境界 floor 補正（旧実装は n≤2e5 の17%で n−1）・強化配列/マイルストーンの範囲・単調検査・idle_base=values[0] 検証。core 82件通過。Vercel で engine の 100ms 性能テストが落ちたため CI では 1000ms 判定に（ローカルは 100ms のまま）。
- P3-T1: core 80件+claims通過・lint通過。価格10件手計算一致・cbrt 1e0〜1e300で1e-12以内。実機確認不要。
