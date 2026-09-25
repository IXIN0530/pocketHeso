# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P2 → `docs/plan/P2-core-game.md`
- Last done: P2-T4（変動・大当たり・ST状態機械・手書きシナリオ210件一致・build+core OK）
- Next: P2-T5（Engine パチンコ部）
- Owner hint: Muse Spark（推奨。P2-T5はClaude Codeレビュー。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- P2-T4: 保留4→消化→確変ST100→ST抜け210イベント一致・確変1500玉/2枚・通常600玉/1枚・D-033で細目確定・実機確認不要。
- P2-T3: normal/ST各100万取得±3σ内・保留色カイ二乗<11.345(df=3)・振分け50/50・D-032で細目確定・実機確認不要。
- P2-T2: key=dir*64+bucket・正準speed中央・verify全65536件不一致0。平均滞空1.19sは目標3〜5s未達（P3以降に再調整）。実機確認不要。
