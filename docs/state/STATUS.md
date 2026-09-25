# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P2 → `docs/plan/P2-core-game.md`
- Last done: [P2-T8] 上乗せ（bonus_rounds・uwanose・chain/chainBalls、D-041）
- Next: P2-T9 lt-middle-01と3機種比較
- Owner hint: 誰でも（推奨。P2-T9はClaude Codeレビュー）

## Blockers
- なし

## Notes（最新3件まで）
- P2-T8: 既存66件無変更で71件通過（新規5件: bonus検証・uwanose時刻/出玉・chain・決定論1/2・投影）。実機確認不要。
- P2-T8レビュー: 中3件対応（pachisim理論値にbonus_rounds反映・契約1を1秒刻み化・投影chainをイベント集計と照合）。軽微5件（JackpotView.rounds表示・不要キャスト・同一分岐・RUSH終了時累計の表示・重複検証）は未対応。
- P2-T6レビュー: 払い戻し理論0.66/0.64が目安0.85を約23%下回る→P3経済で寄せる（D-039、P3着手時に再判断）。軽微5件（最大ハマり定義・hatsuariテスト・10M球テスト・TODO等）は未対応。

