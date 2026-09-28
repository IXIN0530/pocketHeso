# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P7 → `docs/plan/P7-soak-tune.md`
- Last done: [P7-fix] T7/T8 レビュー中3件の修正（D-086: 上乗せ前の投影は基本Rのみ＋hiddenRounds・無料保留の当たりrate1テスト・大当たり中のストック保存テスト）
- Next: P7-T9 即時報酬と特別保留の画面 → T10〜T13 の順 → P7-T2 1週間の実運用。並行で人間の実機確認（T7継続）
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- バランス: 9/28 人間が A（大当たりボーナス）と C（行動の即時報酬）を決定（D-080・D-081）。放置を抑える案（背面効率 0.5→0.2 など）と序盤の産出（風車が増えすぎ）は見送り、P7-T10 の内訳を見て人間が判断

## Notes（最新3件まで）
- [P7-fix] (D-086): レビュー中3件。JackpotView.rounds は告知前は基本R、未告知分は hiddenRounds（web は endsAt−(rounds+hidden)×msで開始を逆算、uwanoseで0に）。rate4 打ち中の特別保留・予告ボーナス保留の当たりが出玉・ボーナスとも rate1 のテスト、満タン・大当たり中（restore 挟み）でストック＋投入済み＝受取数のテスト。core140・claims45・web66・fx27・pachisim23・build通過、golden不変。テストは Node の vitest のみで音なし。軽微指摘は未対応。
- [P7-T8] (D-085): claimsはprodMin（逓減は燃料と同段×trust）・メダル累計差分（歩2000/1万・運動10分/60分）・特別保留20分毎3/日・自記+4。CoreはGrant prodMin→ref×分×60（燃料0でも）・bonusStock→空きへ（満タン・大当たり・電サポも保持・自動補充より先）・grantedにballs/bonusHolds・Projection bonusStock・drawGrantHold。core137・claims45・web65・pachisim23・build通過、golden不変。sim7日lightはjackpot11%/action66%NG・初閉店day5・覚醒day4はT10で判断。音なしテスト。
- [P7-T7] (D-084): jackpot_fever廃止→prod_ref下限1・jackpot_bonus round_s180・mult[1,1.5,2.5,4,6,9,12]。CoreはStartedでroundBonus確定・snapshot保持・Endedでpayout＋bonus×実R（上乗せ込）・Stub省略・v4/旧v3読捨・SNAPSHOT_VERSION 3。core130・claims44・web65・pachisim23・build通過、golden更新。sim7日lightはjackpot40%OKだがrush58%/lt48%NG・初閉店day5・EV全強化1.08〜1.23NGはT10で判断。**実機確認待ち**。音は出さずにテスト（端末音量0のまま）。
