# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P6 → `docs/plan/P6-presentation.md`
- Last done: P6-T2 演出シーン（lcd キュー・planSpin・Debug の演出プレビュー4本・予告の赤保留/キリン柄, D-067）
- Next: 人間が実機で P6-T2 のプレビューを確認（任意, 下記 Notes）→ P6-T3 留守中リプレイと実機の音
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P6-T2 (D-067): CueSheet に kind `lcd`（scene/ms/text/color）。`@ph/fx` の `planSpin` が変動開始時に分岐（RNGStream(seed,'presentation',entry)。seed は EngineView に追加）と尺合わせ（実際の変動時間/パターン ms）を1回だけ行い、液晶（`board/lcd.ts` のシェーダー＋起動時に焼くテロップのアトラス）と音・光・揺れ・カメラ（`shake`・`camera shot=lcd` を盤面で実装）に配る。既定パックに reach_n / sp_reach / spsp_gekiatsu（疑似連×2〜3・群予告）/ kakutei（ブラックアウト・キリン柄・確定の虹）。Debug の倍速では液晶だけ（音は鳴らさない）。Debug「演出プレビュー」はホールへ切り替えて実時間で1変動を流し、押すたびに通し番号（2e9+n）が進んで分岐が変わる（結果は Debug 画面の下に `group=1 pseudo3=0` の形で出る）。予告ボタンは fever=赤保留・rush=キリン柄・bonus=金保留。ヘッドレス Chrome x1 で4本の各シーン・当たり・カメラの寄りと戻りを目視、プレビュー中 54〜60fps・32〜47 calls。実機確認（任意）: Debug → 演出プレビューの4本（音が鳴るか・テロップが読めるか・激アツ/確定の光が眩しすぎないか）。
- P6-T1 (D-066): `@ph/shared` に CueSheet 型と `parseCuePack`（分岐 `branches`）。`@ph/fx` に `resolveCueSheet`・`CuePlayer`（途中から再生）・`FlashLayer`（3回/秒・明るさ上限・reduced-motion はフェード、bloom キューの期間を仲介）・`SoundBus`（タップで解錠、合成音）・`Haptics`・`createCueRouter`。web は `fx/fx-host.ts`。P5-T4 と P6-T1 は 9/27 に人間が実機確認済み。
- バランス（9/27 人間の指摘）: 風車を買うと一気に増えすぎる。Debug の x3600（1秒=1時間）と「燃料+12時間」（標準の約1週間分）で加速して見えるが、本番 x1 でも燃料ありの前面で 10分≈270/秒・30分≈3,000/秒・60分≈14,000/秒（役物だけの簡易モデル）、sim econ 標準は初日（燃料1.3h）でアタッカー到達。CC と比べ風車×5・回転体×2.5 と序盤の産出が多く、大当たりフィーバーの寄与は 20〜40%。調整（産出・価格の伸び・フィーバー倍率、spec/23 バランス目標の変更）は人間の判断待ち。
