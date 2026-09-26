# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P6 → `docs/plan/P6-presentation.md`
- Last done: P6-T1 CueSheet 基盤（CuePlayer・SoundBus・FlashLayer・Haptics・既定パック, D-066）
- Next: 人間が実機で P6-T1 の音を確認（任意, 下記 Notes）→ P6-T2 演出シーン
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P6-T1 (D-066): `@ph/shared` に CueSheet 型と `parseCuePack`（未知 kind は捨てる・分岐 `branches`）。`@ph/fx` に `resolveCueSheet`（presentation ストリームで分岐、強度フィルタ）・`CuePlayer`（表示時刻で実行、途中から再生は終わったキューを飛ばし効いている最中のキューに頭出し量を渡す）・`FlashLayer`（Three の加算全画面クアッド、3回/秒・明るさ上限・reduced-motion はフェード、bloom キューの期間を仲介）・`SoundBus`（master→bgm/se/voice、タップで解錠、合成音の描画）・`Haptics`・`createCueRouter`。web は `fx/fx-host.ts`（既定パック・設定の音量→master）、盤面の当たりで `jackpot` キュー、Debug に「キュー再生」。ヘッドレス Chrome でフラッシュの明るさ上昇（83→167）と復帰、ブルーム OFF 60fps を確認。seed は仮に 0（分岐のあるシートを当たりに使う T2 で Engine から渡す）。P5-T4 は 9/27 に人間が実機確認済み（タイムラインの保存なし）。
- P5-T4 (D-065): `app.tsx` を下部タブ（ホール/強化/行動/記録/設定＋`?debug=1` で Debug）に。ホールは常に置き、他タブの間は盤面の描画を止める。強化 `shop-screen`（×1/×10/×100・覚醒・強化8種・閉店と獲得0の警告）、記録 `records-screen`（回転・初当たり・最大連チャン・出玉、閉店履歴、14日分の行動）、設定 `settings-screen`（オート打ち割合とレート・ブースト・ブルーム・音量(P6)・セーブ・リセット）、留守中サマリーはモーダル（「最も熱い当たりを見る」は P6）。数値は `stores/format.ts`。ヘッドレス Chrome x3600 で Debug の燃料+12h→背面10秒（=10時間）→サマリー（燃料切れ時刻）→風車購入を確認、ホール 60fps・32 calls。行動・記録・設定の DB も時間倍率に合わせ Debug DB を使うよう修正。
- P5-T3 (D-064): `screens/hall-screen.tsx`（盤面＋HUD 持ち玉/メダル/燃料/生産・モード/回転/大当たり・打つトグル・レート（解放2段目から表示）・予告ボタン）。液晶は `board/lcd-timeline.ts` で Engine のイベントを表示時刻で再生（保留は色＋形: 白青=丸・緑=ひし形・赤=星4・金=星5、当該保留は中央下）。リーチは左右を早めに揃えて中を終了時刻まで回す。大当たり開始で当たり演出。仮の打つボタンは削除。ヘッドレス Chrome x1 で 60fps・約34 draw call、リーチと保留を目視。`?spike=bakeoff` の液晶は Engine が無いので回らない（当たり演出のタップは可）。初期の持ち玉100は約1分で尽きる（Lv0 は生産0）ので、実機で長く見るには燃料＋強化が要る（P5-T4）。
