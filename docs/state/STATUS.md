# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P7 → `docs/plan/P7-soak-tune.md`
- Last done: [P7-T9] 即時報酬と特別保留の画面（受け取り確認の玉見込み・トースト・今日の残り・HUDストック・液晶「特」の札・記録）
- Next: P7-T10 試算とバランス目標の確認 → T11〜T13 の順 → P7-T2 1週間の実運用。並行で人間の実機確認（T7・T9）
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- バランス: 9/28 人間が A（大当たりボーナス）と C（行動の即時報酬）を決定（D-080・D-081）。放置を抑える案（背面効率 0.5→0.2 など）と序盤の産出（風車が増えすぎ）は見送り、P7-T10 の内訳を見て人間が判断

## Notes（最新3件まで）
- [P7-T9]: 確認画面「玉 生産◯ぶん ≈ ◯玉」（refPerSec×分×60）・特別保留、確定後トーストは granted の balls 合計（receiveClaims が返す）。今日の残りは上限超えの仮入力を planGrants に通して算出（歩数＋施設チェックイン＋自己申告）。HUD は bonusStock>0 で「特別保留 ×n（待機）」。液晶は serial 1.5e9 台に「特」の札（Projection から復元した保留は -1 で札なし＝既知の制限）。記録は日別に 生産◯ぶん・特別保留（玉数は台帳に無い）、統計に大当たりボーナス。Debug の付与は確認シート経由・玉/特別保留ボタン追加。ヘッドレス Chrome(CDP, x60)で 見込み3,600玉→持ち玉100→3,700・トースト・記録、x1 で札と「×2（待機）」を確認。web72・build通過。音なし。**実機確認待ち**。
- [P7-T8] (D-085): claimsはprodMin（逓減は燃料と同段×trust）・メダル累計差分（歩2000/1万・運動10分/60分）・特別保留20分毎3/日・自記+4。CoreはGrant prodMin→ref×分×60（燃料0でも）・bonusStock→空きへ（満タン・大当たり・電サポも保持・自動補充より先）・grantedにballs/bonusHolds・Projection bonusStock・drawGrantHold。core137・claims45・web65・pachisim23・build通過、golden不変。sim7日lightはjackpot11%/action66%NG・初閉店day5・覚醒day4はT10で判断。音なしテスト。
- [P7-fix] (D-086): レビュー中3件。JackpotView.rounds は告知前は基本R、未告知分は hiddenRounds。rate4 打ち中の特別保留・予告ボーナス保留の当たりが rate1 のテスト、満タン・大当たり中のストック保存テスト。core140・claims45・web66・fx27・pachisim23・build通過、golden不変。T7 の**実機確認待ち**は継続。
