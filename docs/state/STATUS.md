# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P1 → `docs/plan/P1-core-physics.md`
- Last done: P1-T1（数学・乱数: Vec2・splitmix32・xoshiro128**・RNGStream を実装、公開ベクタで固定）
- Next: P1-T2（盤面モデルとローダー）
- Owner hint: Muse Spark（推奨。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- P1-T1: FNV-1a・xoshiro128** は公開ベクタで固定（streamSeed は `seed:id:index` の FNV-1a）。全ゼロ種は s0=1 に補正。
- P0-T6 実測: 16e で Three.js の台はブルーム OFF なら pixelRatio 1〜3 のどれでも 60fps、ON で約 40fps → ブルームは CueSheet の `bloom` で数秒だけ（D-026）。
- P0-T5 実測: 消音 ON だと Web Audio は audioSession.type に関わらず鳴らない（Context 作成前に playback にした場合は未検証 → P6）。
