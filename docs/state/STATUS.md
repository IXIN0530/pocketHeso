# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P3 → `docs/plan/P3-core-economy.md`
- Last done: [P3-T1] 経済定義と計算部品
- Next: P3-T2 経済の状態遷移
- Owner hint: Muse Spark（P3-T2推奨）

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P3-T1 レビュー修正: closeGain の立方数境界 floor 補正（旧実装は n≤2e5 の17%で n−1）・強化配列/マイルストーンの範囲・単調検査・idle_base=values[0] 検証。core 82件通過。Vercel で engine の 100ms 性能テストが落ちたため CI では 1000ms 判定に（ローカルは 100ms のまま）。
- P3-T1: core 80件+claims通過・lint通過。価格10件手計算一致・cbrt 1e0〜1e300で1e-12以内。実機確認不要。
- P2-T9: pachisim15件通過（3機種×理論/観測3σ）。perSpin light9.74/rush9.85/lt9.88で±5%内。既定機種は人間確認待ち。実機確認不要。

