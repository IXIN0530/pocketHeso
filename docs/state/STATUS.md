# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P2 → `docs/plan/P2-core-game.md`
- Last done: [P2-T6] レビュー中4件修正（Atlas盤面ハッシュ検証・core定数化・3σ許容差・払い戻し目安行, D-039）
- Next: P2-T7（時短・LT）→ P2-T8 上乗せ → P2-T9 3機種比較
- Owner hint: 誰でも（推奨。P2-T7はClaude Codeレビュー）

## Blockers
- なし

## Notes（最新3件まで）
- P2-T6レビュー: 払い戻し理論0.66/0.64が目安0.85を約23%下回る→P3経済で寄せる（D-039、P3着手時に再判断）。軽微5件（最大ハマり定義・hatsuariテスト・10M球テスト・TODO等）は未対応。
- 時短・LT・上乗せを計画（D-037・spec/21 モード拡張節・P2-T7〜T9）。例機種 lt-middle-01 の数値は理論値で、T9 の実測で調整する。
- P2-T5レビュー: 同刻append一致とrestoreの経済保持を修正。残る中2件（大当たり/ST跨ぎの決定論テスト・持ち玉0で発射停止するか）はP3前に判断。実機確認不要。

