# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P2 → `docs/plan/P2-core-game.md`
- Last done: 振分けのモード別化（weight_st）と一撃型 rush-middle-01 追加（D-036）
- Next: P2-T6（pachisimレポート。light/rush を比較）→ P2-T7 時短・LT → P2-T8 上乗せ → P2-T9 3機種比較
- Owner hint: Muse Spark（推奨。P2-T6はClaude Codeレビュー。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- 時短・LT・上乗せを計画（D-037・spec/21 モード拡張節・P2-T7〜T9）。例機種 lt-middle-01 の数値は理論値で、T9 の実測で調整する。
- rush-middle-01: 1/349.9・RUSH突入35%・ST1/39.9×75回で継続約85%・RUSH中は全て1500玉。通常1回転あたり期待出玉 9.85玉（light 9.74玉）に揃えた理論値。実測はP2-T6で。
- P2-T5レビュー: 同刻append一致とrestoreの経済保持を修正。残る中2件（大当たり/ST跨ぎの決定論テスト・持ち玉0で発射停止するか）はP3前に判断。実機確認不要。
