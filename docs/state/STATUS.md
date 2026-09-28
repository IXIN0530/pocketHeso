# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P7 → `docs/plan/P7-soak-tune.md`
- Last done: [P7-T7] 大当たりボーナス（D-080・D-084: refPerSec下限1・roundBonus=ref×180×レート倍率・Endedで出玉＋bonus×実R・Totals bonusBalls・HUDも込み・golden 613c145a8f8fd75b）
- Next: P7-T8 行動の即時報酬・メダル・特別保留 → T9〜T13 の順 → P7-T2 1週間の実運用。並行で人間の実機確認（T7: 大当たりで液晶の獲得出玉が生産◯分ぶん増え終わ後に持ち玉が同じだけ増える。D-076〜D-079も継続）
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- バランス: 9/28 人間が A（大当たりボーナス）と C（行動の即時報酬）を決定（D-080・D-081）。放置を抑える案（背面効率 0.5→0.2 など）と序盤の産出（風車が増えすぎ）は見送り、P7-T10 の内訳を見て人間が判断

## Notes（最新3件まで）
- [P7-T7] (D-084): jackpot_fever廃止→prod_ref下限1・jackpot_bonus round_s180・mult[1,1.5,2.5,4,6,9,12]。CoreはStartedでroundBonus確定・snapshot保持・Endedでpayout＋bonus×実R（上乗せ込）・Stub省略・v4/旧v3読捨・SNAPSHOT_VERSION 3。core130・claims44・web65・pachisim23・build通過、golden更新。sim7日lightはjackpot40%OKだがrush58%/lt48%NG・初閉店day5・EV全強化1.08〜1.23NGはT10で判断。**実機確認待ち**。音は出さずにテスト（端末音量0のまま）。
- [fix] (D-079): 電サポ中は玉を打たずに保留を上限（4）まで自動補充（賞球0・rate1・通し番号2e9〜・snapshotにnextReserve）。変動開始の前後で満タン化するので常に4並び、消化分は最後尾へ追加。同刻holdAddedはspinStartedの後にも出る。無料分の出玉・ボーナスもrate1。core129・claims44・web64・build通過、golden更新。**実機確認待ち**。STの回転数・出玉増はP7-T3で再確認。
- [fix] (D-078): 保留は当該（中央下 x0.5）のすぐ左 x0.4 から 0.075 刻みで左へ（holds[0] が一番右）。変動開始（spin の entry が変わった時）に elapsed で 350ms、その時点の保留だけ右へ1つずれ、次の保留は大きさ 0.04→0.058 で当該の位置へ（uHoldX・uCurPos）。割れる玉は x0.4 から出る。reduced-motion は動かさない。ヘッドレス Chrome で途中のコマを確認。**実機確認待ち**。
