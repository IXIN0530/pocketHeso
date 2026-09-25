# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P1 → `docs/plan/P1-core-physics.md`
- Last done: P1-T4（軌跡API: trajectory(p,every)→{samples,outcome}・runと1万件一致・D-029）
- Next: P1-T5（決定論と性能）
- Owner hint: Muse Spark（推奨。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- P1-T4: trajectoryはstep/sense共有・samplesはstep0＋every毎＋最終点・outcomeはrunと同一。D-029で仕様拡張を記録。
- P1-T3: step()はP1-T4のtrajectoryと共有する内部関数（コピペなし）。D-028でAPI拡張を記録。
- P1-T2: 盤面ハッシュ db4c3c9a…（16桁 db4c3c9a691e5284）。launch_dirs は真上中心±0.1rad（D-027）。
