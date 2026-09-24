# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P1 → `docs/plan/P1-core-physics.md`
- Last done: P0-T6（Three.js スパイク → 描画を Three.js に全面移行, D-026。spec/50 書き直し、Pixi を削除）
- Next: P1-T1（数学・乱数）
- Owner hint: Muse Spark（推奨。誰が進めてもよい）

## Blockers
- なし

## Notes（最新3件まで）
- P0-T6 実測: 16e で Three.js の台はブルーム OFF なら pixelRatio 1〜3 のどれでも 60fps、ON で約 40fps → ブルームは CueSheet の `bloom` で数秒だけ（D-026）。
- P0-T6: 10分連続の発熱は未計測 → P5-T4 の Accept に移した。gzip は Three 一式 約144KB（Pixi 一式 約165KB）。
- P0-T5 実測: 消音 ON だと Web Audio は audioSession.type に関わらず鳴らない（Context 作成前に playback にした場合は未検証 → P6）。
