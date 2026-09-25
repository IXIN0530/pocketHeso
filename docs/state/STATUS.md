# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P4 → `docs/plan/P4-activity.md`
- Last done: [P3-T4] 経済試算（`pnpm sim econ`）と数値調整（D-048）
- Next: P4-T1 台帳と変換規則
- Owner hint: Claude Code（P4-T1推奨）

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P3-T4: `pnpm sim econ --profile standard|none|heavy --days N [--seed/--machine/--economy/--ev-hours/--json]`（貪欲・レート1）。D-048で調整し目標3点OK（標準: クルーン1日目・覚醒3日目・初閉店7〜8日目(seed1〜3/3機種)、行動なし61日閉店なし、EV初期0.80〜0.85/全強化0.92〜0.99）。要人間判断: パチンコ由来メダル98%（オートは燃料0でも24h打てる）・spec/23本文は旧値のまま・rate>1はD-034のコスト1玉固定で有利。golden→fdc33df4b9110301。core・build・all通過。実機確認不要。
- P3-T3 レビュー修正: 経済tickをグリッド時刻で先払い（D-047）・予告出現時刻を nextEventTime に追加。不揃い刻み(1〜7777ms)vs1回の一致テスト追加、golden→09b9d3e3850ee32d（予告時刻の補正のみが原因と確認）。core・build通過。実機確認不要。
- P3-T3: 予告（前面5〜15分/RNG・13秒・fever×7/77s・rush・bonus1/10）＋auto解放/止め打ち・釘q・短縮0.9^・保留+1（上限6）・レート段階・AwaySummary・projection（notice/nextHot/feverMs/phase）。契約1/2/4＋golden e59bd2b4c5c87dd2・24h150ms（単独85〜97ms）。core103件・lint・build通過。実機確認不要。
