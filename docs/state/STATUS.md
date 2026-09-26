# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P6 → `docs/plan/P6-presentation.md`（P5 は実機確認のみ残り）
- Last done: P5-T4 強化・記録・設定・留守中サマリー・Debug（下部タブ, D-065）
- Next: 人間が実機で P5-T4 を確認（x3600 の一連の流れ・ブルーム OFF で10分 60fps をタイムラインで `logs/` に）→ P6-T1 CueSheet 基盤
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P5-T4 (D-065): `app.tsx` を下部タブ（ホール/強化/行動/記録/設定＋`?debug=1` で Debug）に。ホールは常に置き、他タブの間は盤面の描画を止める。強化 `shop-screen`（×1/×10/×100・覚醒・強化8種・閉店と獲得0の警告）、記録 `records-screen`（回転・初当たり・最大連チャン・出玉、閉店履歴、14日分の行動）、設定 `settings-screen`（オート打ち割合とレート・ブースト・ブルーム・音量(P6)・セーブ・リセット）、留守中サマリーはモーダル（「最も熱い当たりを見る」は P6）。数値は `stores/format.ts`。ヘッドレス Chrome x3600 で Debug の燃料+12h→背面10秒（=10時間）→サマリー（燃料切れ時刻）→風車購入を確認、ホール 60fps・32 calls。行動・記録・設定の DB も時間倍率に合わせ Debug DB を使うよう修正。
- P5-T3 (D-064): `screens/hall-screen.tsx`（盤面＋HUD 持ち玉/メダル/燃料/生産・モード/回転/大当たり・打つトグル・レート（解放2段目から表示）・予告ボタン）。液晶は `board/lcd-timeline.ts` で Engine のイベントを表示時刻で再生（保留は色＋形: 白青=丸・緑=ひし形・赤=星4・金=星5、当該保留は中央下）。リーチは左右を早めに揃えて中を終了時刻まで回す。大当たり開始で当たり演出。仮の打つボタンは削除。ヘッドレス Chrome x1 で 60fps・約34 draw call、リーチと保留を目視。`?spike=bakeoff` の液晶は Engine が無いので回らない（当たり演出のタップは可）。初期の持ち玉100は約1分で尽きる（Lv0 は生産0）ので、実機で長く見るには燃料＋強化が要る（P5-T4）。
- P5-T2 (D-063): `apps/web/src/board/`（board-scene・ball-tracks・board-canvas、スパイクの art/cabinet/lcd を移設）。本体トップに盤面を遅延読み込みで表示。玉は Engine の Shot（Worker が fired/sensor＋Core の新 `inFlight()` から作る）を「時計−1.3秒×倍率」で再生、釘強化の out→start1 はヘソ行きの軌跡に差し替え。役物は YakumonoView.periodS（Core に追加）で回し、未解放は暗い。`?debug=1` で fps/calls、`&x=60|3600` で時間倍率（別 DB）。仮の「打つ/止める」ボタンあり。ヘッドレス Chrome で x1・x60 とも 60fps・約 34 draw call。未: 役物1周ごとの「+玉数」（Projection に1周の玉数が無い）、液晶の保留は盤面のヘソ入賞で仮に増やしている（P5-T3 で Projection に）。`?spike=bakeoff` は本番シーン＋デモの玉。
