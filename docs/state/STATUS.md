# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P3 → `docs/plan/P3-core-economy.md`
- Last done: [P3-T3] レビュー修正（不揃い刻みでの経済tick消失・予告時刻ずれ）
- Next: P3-T4 経済試算
- Owner hint: Muse Spark（P3-T4推奨、Review: Claude Code）

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P3-T3 レビュー修正: 経済tickをグリッド時刻で先払い（D-047）・予告出現時刻を nextEventTime に追加。不揃い刻み(1〜7777ms)vs1回の一致テスト追加、golden→09b9d3e3850ee32d（予告時刻の補正のみが原因と確認）。core・build通過。実機確認不要。
- P3-T3: 予告（前面5〜15分/RNG・13秒・fever×7/77s・rush・bonus1/10）＋auto解放/止め打ち・釘q・短縮0.9^・保留+1（上限6）・レート段階・AwaySummary・projection（notice/nextHot/feverMs/phase）。契約1/2/4＋golden e59bd2b4c5c87dd2・24h150ms（単独85〜97ms）。core103件・lint・build通過。実機確認不要。
- P3-T2: IdleEconomy＋Engine1000ms統合。手書きシナリオ一致・overflow/boost/buy/awaken/close/streak・決定論1vs刻み/snapshot一致。core88件・build通過。実機確認不要。
