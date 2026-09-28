# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P7 → `docs/plan/P7-soak-tune.md`
- Last done: [P7-T8] 行動の即時報酬・メダル・特別保留（D-081・D-085: prodMin×trust・bonusHolds・Grant balls・bonusStock・drawGrantHold・sim行動列・メダル40/週・golden不変613c145a8f8fd75b）
- Next: P7-T9 即時報酬と特別保留の画面 → T10〜T13 の順 → P7-T2 1週間の実運用。並行で人間の実機確認（T7継続）
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- バランス: 9/28 人間が A（大当たりボーナス）と C（行動の即時報酬）を決定（D-080・D-081）。放置を抑える案（背面効率 0.5→0.2 など）と序盤の産出（風車が増えすぎ）は見送り、P7-T10 の内訳を見て人間が判断

## Notes（最新3件まで）
- [P7-T8] (D-085): claimsはprodMin（逓減は燃料と同段×trust）・メダル累計差分（歩2000/1万・運動10分/60分）・特別保留20分毎3/日・自記+4。CoreはGrant prodMin→ref×分×60（燃料0でも）・bonusStock→空きへ（満タン・大当たり・電サポも保持・自動補充より先）・grantedにballs/bonusHolds・Projection bonusStock・drawGrantHold。core137・claims45・web65・pachisim23・build通過、golden不変。sim7日lightはjackpot11%/action66%NG・初閉店day5・覚醒day4はT10で判断。音なしテスト。
- [P7-T7] (D-084): jackpot_fever廃止→prod_ref下限1・jackpot_bonus round_s180・mult[1,1.5,2.5,4,6,9,12]。CoreはStartedでroundBonus確定・snapshot保持・Endedでpayout＋bonus×実R（上乗せ込）・Stub省略・v4/旧v3読捨・SNAPSHOT_VERSION 3。core130・claims44・web65・pachisim23・build通過、golden更新。sim7日lightはjackpot40%OKだがrush58%/lt48%NG・初閉店day5・EV全強化1.08〜1.23NGはT10で判断。**実機確認待ち**。音は出さずにテスト（端末音量0のまま）。
- [fix] (D-079): 電サポ中は玉を打たずに保留を上限（4）まで自動補充（賞球0・rate1・通し番号2e9〜・snapshotにnextReserve）。変動開始の前後で満タン化するので常に4並び、消化分は最後尾へ追加。同刻holdAddedはspinStartedの後にも出る。無料分の出玉・ボーナスもrate1。core129・claims44・web64・build通過、golden更新。**実機確認待ち**。STの回転数・出玉増はP7-T3で再確認。
