# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P2 → `docs/plan/P2-core-game.md`
- Last done: [P2-T7] モード拡張（時短・LT。jitan/lt・spins・next・weight_jitan/lt、D-040）
- Next: P2-T8 上乗せ → P2-T9 3機種比較
- Owner hint: 誰でも（推奨。P2-T8はClaude Codeレビュー）

## Blockers
- なし

## Notes（最新3件まで）
- P2-T7: 既存テスト無変更で66件通過＋新規4件（手書き全遷移・100万取得±3σ）。強制短縮はしない（D-040）。実機確認不要。
- P2-T6レビュー: 払い戻し理論0.66/0.64が目安0.85を約23%下回る→P3経済で寄せる（D-039、P3着手時に再判断）。軽微5件（最大ハマり定義・hatsuariテスト・10M球テスト・TODO等）は未対応。
- 時短・LT・上乗せを計画（D-037・spec/21 モード拡張節・P2-T7〜T9）。例機種 lt-middle-01 の数値は理論値で、T9 の実測で調整する。

