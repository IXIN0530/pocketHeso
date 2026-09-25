# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P2 → `docs/plan/P2-core-game.md`
- Last done: [P2-T6] pachisimレポート（light/rush理論vs10M球実測、許容差内、D-038）
- Next: P2-T7（時短・LT）→ P2-T8 上乗せ → P2-T9 3機種比較
- Owner hint: 誰でも（推奨。P2-T7はClaude Codeレビュー）

## Blockers
- なし

## Notes（最新3件まで）
- P2-T6実測（10M球 seed20260925）: light初当たり1/192.0・ST46.6%・通常1回転10.59玉、rush1/332.5・ST85.2%・10.31玉。理論（9.74/9.85玉）と許容差内で一致。
- 時短・LT・上乗せを計画（D-037・spec/21 モード拡張節・P2-T7〜T9）。例機種 lt-middle-01 の数値は理論値で、T9 の実測で調整する。
- P2-T5レビュー: 同刻append一致とrestoreの経済保持を修正。残る中2件（大当たり/ST跨ぎの決定論テスト・持ち玉0で発射停止するか）はP3前に判断。実機確認不要。
