# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P7 → `docs/plan/P7-soak-tune.md`
- Last done: [P7-fix] 電サポ中（jitan/st/lt）の保留自動補充（D-079）。その前に [P7-fix] 保留の並びと1つずれる動き（D-078）
- Next: 実機確認（ST/LT/時短で玉を打たずに保留4が保たれ抽選が進むこと。RUSH突入直後の表示／大当たり中の表示: Debug の演出プレビューを「当たり」で流すと始めの「大当たり nR」まで見える。ラウンド・出玉・結果の告知は実際の大当たりで確認／割れる演出の長さ）→ P7-T2 1週間の実運用
- Owner hint: 人間 + Claude Code（ログ解析）

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- バランス（9/27 人間の指摘: 風車を買うと増えすぎ。本番 x1 でも前面60分≈14,000/秒）: 産出・価格の伸び・フィーバー倍率の調整は人間の判断待ち（P7-T3。試算は commit 62de483 時点の STATUS Notes）

## Notes（最新3件まで）
- [fix] (D-079): 電サポ中は玉を打たずに保留を上限（4）まで自動補充（賞球0・rate1・通し番号2e9〜・snapshotにnextReserve）。変動開始の前後で満タン化するので常に4並び、消化分は最後尾へ追加。同刻holdAddedはspinStartedの後にも出る。無料分の出玉・フィーバーはrate1。core129・claims44・web64・build通過、golden更新。**実機確認待ち**。STの回転数・出玉増はP7-T3で再確認。
- [fix] (D-078): 保留は当該（中央下 x0.5）のすぐ左 x0.4 から 0.075 刻みで左へ（holds[0] が一番右）。変動開始（spin の entry が変わった時）に elapsed で 350ms、その時点の保留だけ右へ1つずれ、次の保留は大きさ 0.04→0.058 で当該の位置へ（uHoldX・uCurPos）。割れる玉は x0.4 から出る。reduced-motion は動かさない。ヘッドレス Chrome で途中のコマを確認。**実機確認待ち**。
- [fix] (D-077): 大当たり中は液晶に 2D Canvas（hud-canvas.ts、変わった時と告知の動く間だけ約30回/秒で描き直す）を重ねる。中身は jackpotHud（jackpot-hud.ts）。LcdTimeline が modeChanged も受け、jackpotEnded と同じ時刻のモード変更で結果（rushIn/ltIn/rushOn/rushEnd/jitanIn/end）と連チャンを決める。音は pack の round・uwanose・rush_in・rush_on・rush_end・bonus_end（既存の合成音）。ヘッドレス Chrome で8画面を確認。**実機確認待ち**: 文字の大きさ・図柄の暗さ・告知の音。
- [fix] (D-076): HOLD_BREAK_MS = grow 1350・crack 1800・reveal 4500・reels 5000・end 5400、ひびは HOLD_CRACK_STEPS_MS（1950〜4280ms の7回）に液晶と crack の音が同時に伸びる。変動時間は Core が決めるので短い変動は holdBreakScale（(変動−1200)/5000, 下限0.15）で液晶・音ごと縮める（5秒→0.76, 保留3〜4の2秒→0.16）。玉の半径 0.2→0.3、出てくる保留 0.16→0.24、点滅保留の白い後光は裾を広げた。ヘッドレス Chrome で各段階を確認。大当たりの確認: Core は正しく ST 回数内の抽選で継続を決めている（事前に継続数を決めていない）。「4R」は light の通常大当たり（初当たり・RUSH 中とも50%、RUSH は終了）。**実機確認待ち**。
