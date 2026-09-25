# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P2 → `docs/plan/P2-core-game.md`
- Last done: P1-T5（決定論ゴールデン 57bb3c08…・bench 5.3万発/秒・pnpm sim bench）
- Next: P2-T1（機種仕様）
- Owner hint: Muse Spark（推奨。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- P1-T5: 固定1000発ゴールデン57bb3c081e328c78（SHA-256先頭16桁）・bench 53191発/秒（≧2000）・正規化列はASCII固定でブラウザ subtle と同一前提。
- P1-T4: trajectoryはstep/sense共有・samplesはstep0＋every毎＋最終点・outcomeはrunと同一。D-029で仕様拡張を記録。
- P1-T3: step()はP1-T4のtrajectoryと共有する内部関数（コピペなし）。D-028でAPI拡張を記録。
