# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P7 → `docs/plan/P7-soak-tune.md`
- Last done: P6-T3 留守中リプレイ（AwaySummary.replay・留守モーダルの「最も熱い当たりを見る」・Debug の音の状態, D-068）＋実機の音・光の確認を platform-limits に記録。P6 完了
- Next: P7-T1 ローカル計測ログ
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P6-T3 (D-068): Core の AwaySummary に `replay`（留守中に変動を始めて大当たりになった保留のうち hot 最大。entry・pattern・color・開始/終了・kind・rounds は Engine のイベントそのもの）。留守モーダルの「最も熱い当たりを見る（時刻）」で Debug の演出プレビューと同じ経路に Engine の保留番号・実際の変動時間のまま流す（分岐と尺がその場と同じ）。再生中はホール上部に「リプレイ h:mm の当たり」。ヘッドレス Chrome x3600 で留守4時間→replay（激アツ・赤保留・70秒）→当たりの虹→札が消えて通常の液晶へ、を確認。Debug に「音の状態」（AudioContext の state・Hz・audioSession・表示状態）と「留守サマリーを再表示」。9/27 人間が実機で音量ボタン・消音・背面復帰・リプレイの音・光の眩しさを確認（「おそらく全部OK」, platform-limits に記録）。
- P6-T2 (D-067): CueSheet に kind `lcd`（scene/ms/text/color）。`@ph/fx` の `planSpin` が変動開始時に分岐（RNGStream(seed,'presentation',entry)。seed は EngineView に追加）と尺合わせ（実際の変動時間/パターン ms）を1回だけ行い、液晶（`board/lcd.ts` のシェーダー＋起動時に焼くテロップのアトラス）と音・光・揺れ・カメラ（`shake`・`camera shot=lcd` を盤面で実装）に配る。既定パックに reach_n / sp_reach / spsp_gekiatsu（疑似連×2〜3・群予告）/ kakutei（ブラックアウト・キリン柄・確定の虹）。Debug の倍速では液晶だけ（音は鳴らさない）。Debug「演出プレビュー」はホールへ切り替えて実時間で1変動を流し、押すたびに通し番号（2e9+n）が進んで分岐が変わる（結果は Debug 画面の下に `group=1 pseudo3=0` の形で出る）。予告ボタンは fever=赤保留・rush=キリン柄・bonus=金保留。ヘッドレス Chrome x1 で4本の各シーン・当たり・カメラの寄りと戻りを目視、プレビュー中 54〜60fps・32〜47 calls。9/27 人間が実機確認済み。
- バランス（9/27 人間の指摘）: 風車を買うと一気に増えすぎる。Debug の x3600（1秒=1時間）と「燃料+12時間」（標準の約1週間分）で加速して見えるが、本番 x1 でも燃料ありの前面で 10分≈270/秒・30分≈3,000/秒・60分≈14,000/秒（役物だけの簡易モデル）、sim econ 標準は初日（燃料1.3h）でアタッカー到達。CC と比べ風車×5・回転体×2.5 と序盤の産出が多く、大当たりフィーバーの寄与は 20〜40%。調整（産出・価格の伸び・フィーバー倍率、spec/23 バランス目標の変更）は人間の判断待ち。
