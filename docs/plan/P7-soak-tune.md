# P7 Soak & Tune

### P7-T1 ローカル計測ログ
Owner: Claude Code | Read: spec/40-app-ui（Debug）
Do: 起動時の追いつき時間、Worker の advance 時間、IndexedDB サイズ、受け取り回数を `metrics` store に記録し Debug に表示。

### P7-T2 1週間の実運用
Owner: 人間 + Claude Code（ログ解析）
Accept:
- [ ] 7日間の行動・獲得・閉店までの進み・不満点を `docs/state/soak-YYYYMMDD.md`（40行以内）にまとめる

### P7-T3 バランス調整
Owner: Muse Spark | Read: spec/23-core-economy, spec/30-activity-claims（変換節）, spec/21-core-lottery
Do: 実運用を踏まえて economy / machines JSON を調整 → `pnpm sim econ` と `pnpm sim run` で確認 → ゴールデン更新（DECISIONS に記録）。

### P7-T4 保留色の作り直し（リゼロ2寄せ・確変中は別表・保留変化）
Owner: Claude Code | Read: spec/21-core-lottery, spec/43-presentation-effects, spec/22-core-engine（SimEvent・決定論）
背景（9/27 人間）: 今は通常時の約90%が青・赤の信頼度5.4%・金は確定・白は1/200で出るハズレ確定（D-032 の「白は重みの残り」だと、ハズレの時に色が付く割合が必ず10%以上になる）。
方針（決定済み）: 確変中は別の表。鬼アツにあたる色は足さず、金まで。保留変化を加える。
Do:
- Core: 白の重みを JSON に書けるようにする（D-032 の「白は残り」をやめる）。表を2つ持つ: `hold_colors`（normal・jitan）と `hold_colors_st`（st・lt）。取得時のモードで選ぶ。`drawBonus`（予告の bonus=金保留, D-067）で使う表も見直す
- 通常時の表（1/349.9 が目標）: 当たりの時の重み /100 は 白5・青10・緑15・赤40・金30。ハズレの時の重み /100000 は 青381・緑172・赤115・金15・残りを白
  → 信頼度は 青7%・緑20%・赤50%・金85%、出現率は 青1/245・緑1/467・赤1/437・金1/993（色が付くのは合計約1/105）
- 確変中の表: 目標の信頼度と出現率はタスクを始める時に案を出し、人間が決める（通常時の表のままだと、ST中の赤は90%・金は98%）
- 保留変化: 最終色は今どおり Core が取得時に決める。表示を始める色（白からなど）・途中の段階・変わる時点（取得時/前の保留が消化された時/変動開始時）は @ph/fx で `RNGStream(seed,'holdChange',serial)` から決め、液晶の保留表示と CueSheet（音・光）に出す。最終色より格上の色は途中で見せない
- 決めること: 金が確定でなくなる。今の「赤は熱さ+1、金は熱さ5（最大）」（D-032）を残すか、案を出して人間が決める
- machines JSON 3つを更新する。ゴールデンを更新する。DECISIONS に書く（D-032 を上書き）
Accept:
- [x] `scripts/sim.sh` で通常時・ST中それぞれ十分な回転数を回し、各色の出現率と信頼度が目標に近いこと（`scripts/sim.sh holds`、200万回転、許容 信頼度±2pt・出現率±8%）
- [x] 保留変化が液晶に出て、変わる時に音・光が鳴る。留守中リプレイ（D-068）でも同じ結果になる
- [ ] `scripts/test.sh all` と `scripts/build.sh` が通る（済）。実機で見た目を確認してもらう

### P7-T5 通常時の先バレ
Owner: Claude Code | Read: spec/43-presentation-effects（保留変化）
背景（9/27 人間）: ST 中のような先バレを通常時の当たりにも。先バレの信頼度は約4割。先バレで変わった保留の各色の信頼度は通常時と同じでよい。
Accept:
- [x] 通常時の表で先バレの信頼度が 40%±2pt（3機種）、先バレした保留の各色の信頼度が保留色の表と同じ（当否を見ない）
- [x] 玉が入ってすぐ先バレの音・光・振動、保留は白で出て取得時の変化で最終色へ。リプレイ・プレビューでは鳴らさない
- [ ] `scripts/test.sh all` と `scripts/build.sh` が通る（済）。実機で先バレの音と光を確認してもらう

### P7-T6 変化保留が割れる演出
Owner: Claude Code | Read: spec/43-presentation-effects（保留変化）
背景（9/27 人間）: 変化する保留は灰色で点滅して出て、自分の抽選でパチンコ玉になり、ひびが入って割れ、中から色の保留が出て画面全体に色が広がってから図柄が回る。先バレも灰色の点滅で出る。
Accept:
- [x] 変化する保留（先バレを含む）は灰色で点滅して出て、自分の変動開始まで色が変わらない。取得時・消化時の変化・色から始まる変化・2段階はなし（D-075）
- [x] 変動開始で 玉になる → ひび → 割れて最終色 → 液晶と画面全体に色が広がる → 図柄が回る。リプレイ・プレビューでも同じ時刻に同じ色
- [ ] `scripts/test.sh all` と `scripts/build.sh` が通る（済）。実機で見た目・音・長さを確認してもらう
