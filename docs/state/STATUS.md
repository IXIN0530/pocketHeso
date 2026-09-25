# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P1 → `docs/plan/P1-core-physics.md`
- Last done: P1-T2（盤面モデルとローダー: Board検証・正規化ハッシュ・launch_dirs・default.json釘322本/役物8）
- Next: P1-T3（物理ステップ）
- Owner hint: Muse Spark（推奨。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- P1-T2: 盤面ハッシュ db4c3c9a…（16桁 db4c3c9a691e5284）。launch_dirs は真上中心±0.1rad（D-027）。
- P1-T1: FNV-1a・xoshiro128** は公開ベクタで固定（streamSeed は `seed:id:index` の FNV-1a）。全ゼロ種は s0=1 に補正。
- P0-T6 実測: 16e で Three.js の台はブルーム OFF なら pixelRatio 1〜3 のどれでも 60fps、ON で約 40fps → ブルームは CueSheet の `bloom` で数秒だけ（D-026）。
