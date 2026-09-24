# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P0 → `docs/plan/P0-bootstrap.md`
- Last done: P0-T5（描画・保存・音のスパイク。16e で 60fps、persist 済み、消音時は Web Audio 無音）
- Next: P0-T6（Three.js の見た目と性能のスパイク。良ければ全面移行）→ その後 P1-T1
- Owner hint: Claude Code

## Blockers
- なし

## Notes（最新3件まで）
- P0-T5 実測: 16e で spec/50 の負荷（虹・色相フィルタ込み、res 3）が 59.9fps。描画性能は余裕あり。
- P0-T5 実測: 消音 ON だと Web Audio は audioSession.type に関わらず鳴らない（type 変更は Context 作成後。作成前に playback にした場合は未検証）。`<audio>` は playback/auto なら鳴る。
- P0-T4 実測: 位置の許可はホーム画面アプリでも起動のたびに聞かれる。accuracy は自宅（屋外・窓際）7〜17m。屋内ジムは未計測 → P4 で測る。
