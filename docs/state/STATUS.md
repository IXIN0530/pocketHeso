# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P2 → `docs/plan/P2-core-game.md`
- Last done: P2-T2（Outcome Atlas・単一/4並列バイナリ一致・default.9489bfc699495d5a.bin 458796B・ヘソ5.80%・build+all OK）
- Next: P2-T3（抽選と保留）
- Owner hint: Muse Spark（推奨。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- P2-T2: key=dir*64+bucket・正準speed中央・verify全65536件不一致0。平均滞空1.19sは目標3〜5s未達（P3以降に再調整）。実機確認不要。
- P2-T1: MachineSpec/PatternTable検証・閾値floor(2^32/N)・resources/machines 2件・実機確認不要。
- P1-T5: 固定1000発ゴールデン57bb3c081e328c78（SHA-256先頭16桁）・bench 53191発/秒（≧2000）・正規化列はASCII固定でブラウザ subtle と同一前提。
