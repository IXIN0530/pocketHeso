# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P1 → `docs/plan/P1-core-physics.md`
- Last done: P1-T3（物理ステップ: BallSimulator.run・固定dt・衝突・グリッド・センサー・合成322釘で1万発268ms全終了）
- Next: P1-T4（軌跡API）
- Owner hint: Muse Spark（推奨。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- P1-T3: step()はP1-T4のtrajectoryと共有する内部関数（コピペなし）。D-028でAPI拡張を記録。
- P1-T2: 盤面ハッシュ db4c3c9a…（16桁 db4c3c9a691e5284）。launch_dirs は真上中心±0.1rad（D-027）。
- P1-T1: FNV-1a・xoshiro128** は公開ベクタで固定（streamSeed は `seed:id:index` の FNV-1a）。全ゼロ種は s0=1 に補正。
