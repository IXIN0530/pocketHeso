# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P2 → `docs/plan/P2-core-game.md`
- Last done: P2-T3（抽選と保留・100万取得±3σ・色カイ二乗・overflow・build+core OK）
- Next: P2-T4（変動・大当たり・モード状態機械）
- Owner hint: Muse Spark（推奨。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- P2-T3: normal/ST各100万取得±3σ内・保留色カイ二乗<11.345(df=3)・振分け50/50・D-032で細目確定・実機確認不要。
- P2-T2: key=dir*64+bucket・正準speed中央・verify全65536件不一致0。平均滞空1.19sは目標3〜5s未達（P3以降に再調整）。実機確認不要。
- P2-T1: MachineSpec/PatternTable検証・閾値floor(2^32/N)・resources/machines 2件・実機確認不要。
