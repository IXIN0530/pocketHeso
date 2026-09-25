# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P2 → `docs/plan/P2-core-game.md`
- Last done: P2-T1（機種仕様 0c49617・閾値199.8→21496332/39.9→107643290・core 34件+claims 1件・build OK）
- Next: P2-T2（Outcome Atlas）
- Owner hint: Muse Spark（推奨。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- P2-T1: MachineSpec/PatternTable検証・閾値floor(2^32/N)・resources/machines 2件・実機確認不要。
- P1-T5: 固定1000発ゴールデン57bb3c081e328c78（SHA-256先頭16桁）・bench 53191発/秒（≧2000）・正規化列はASCII固定でブラウザ subtle と同一前提。
- P1-T4: trajectoryはstep/sense共有・samplesはstep0＋every毎＋最終点・outcomeはrunと同一。D-029で仕様拡張を記録。
