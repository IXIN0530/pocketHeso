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

---
## バランスの作り直し（9/28 人間, D-080・D-081）
背景: 標準7日の玉の内訳が 役物71% / 大当たりフィーバー29% / 出玉0.0006%。出玉は固定値、フィーバーは液晶に見えず、
行動の報酬は燃料（時間）だけで手応えが無い。値は人間が決定済み（spec/23・spec/30 のとおり。勝手に変えない）。
実行順: T7 → T8 → T9 → T10 → T11 → T12 → T13 → T2（1週間の実運用は作り直しの後に行う）。

### P7-T7 大当たりボーナス（生産連動の出玉）
Owner: Claude Code | Read: spec/23（基準生産・大当たりボーナス・バランス目標）, spec/22（イベント・Projection）, spec/21（出玉節）
Do:
- economy JSON: `jackpot_fever` を消し、`"prod_ref": {"min_per_sec": 1}` と `"jackpot_bonus": {"round_s": 180, "mult_by_rate": [1,1.5,2.5,4,6,9,12]}` を足す
  （`mult_by_rate` は `rate_unlock.rates` と同じ長さ・1以上の昇順。economy-config で検証）
- Core（economy-state）: 大当たりフィーバーの倍率状態をやめ、`getRefPerSec()` と `jackpotRoundBonus(rate)` を足す。旧 snapshot の `jackpotFeverMult` は読んで捨てる
- Core（engine）: jackpotStarted で roundBonus を決めて持ち（snapshot に入れる）、イベントに `roundBonus`。jackpotEnded で `payout + roundBonus × 実ラウンド数（上乗せ込み）` を持ち玉に足し、
  イベントに `bonus`。Totals に `bonusBalls`。経済なし（Stub）では従来どおり（roundBonus/bonus を省略）。SNAPSHOT_VERSION を上げる（古いキャッシュは再計算）
- Projection に `refPerSec`
- web: 液晶の HUD（`apps/web/src/board/jackpot-hud.ts`）の獲得出玉を `出玉 + roundBonus × (済みR + 今のRに入った玉/count)` に、結果告知の出玉と連チャンの合計もボーナス込みに
- sim econ: 内訳の fever 列を「大当たり（出玉＋ボーナス）」に置き換え、判定を spec/23 の新しい目標に（行動の列は T8）
Accept:
- [ ] Core のテスト: rate1 の 10R で bonus = refPerSec×1800、rate100 は ×6、上乗せ込みのラウンド数、無料の保留（予告ボーナス・電サポの自動補充）の当たりは rate1、役物なしは下限 1/秒
- [ ] 決定論契約 1〜3（ゴールデン更新、hash を DECISIONS に）。旧 snapshot（v 旧・jackpotFeverMult あり）から restore しても落ちない
- [ ] jackpot-hud のテストでボーナス込みの獲得出玉・結果告知
- [ ] `scripts/test.sh core`・`scripts/test.sh all`・`scripts/build.sh` が通る。実機: 大当たりで液晶の獲得出玉が生産◯分ぶん増え、終わった後に持ち玉が同じだけ増える

### P7-T8 行動の即時報酬・メダル・特別保留
Owner: Claude Code | Read: spec/30（変換）, spec/22（入力・特別保留）, spec/23（行動の即時報酬）, spec/32（判定と報酬）
Do:
- economy JSON（値は spec のとおり）: `awaken.medal_base` 20、`rate_unlock.medal_costs` [8,20,80,200,800,2000]、`close.medals_per_point` 28。claims 節に
  steps `prod_min_per_1000` 30・`medal_per` 2000・`medal_to` 10000（`medal_at` は消す）、checkin `prod_min_per_min` 10・`medal_per_min` 10・`medal_to_min` 60・
  `bonus_hold_per_min` 20・`bonus_hold_max_per_day` 3・`place_bonus_medals` 4（`medal_min_minutes`・`medal_max_per_day` は消す）、self `prod_min_per_item` 10
- claims: `planGrants` が Grant に `prodMin`（×trust、逓減は燃料と同じ段）・`bonusHolds` を載せ、メダルは「日の累計から決まる枚数 − 既に出した枚数」で出す。self（施設外・終了し忘れを含む）はメダル・特別保留なし
- Core: Grant の `prodMin`（受け取り時点の refPerSec × prodMin × 60 を持ち玉へ。燃料0でも入る）と `bonusHolds`（ストック `bonusStock` → 保留の空きへ。spec/22 の並び・RNG・serial）。
  granted イベントに `balls`・`bonusHolds`、Projection に `bonusStock`。`drawGrantHold` は lottery に置き `drawBonusHold` と同じ規則（賞球なし）
- sim econ: 新しい換算で Grant を作る（できれば @ph/claims の換算関数を使い、sim 内の二重実装 `stepsFuelMin` などをやめる）。内訳に「行動の即時報酬」列
Accept:
- [ ] claims のテスト: 同じ日を何度受け取ってもメダル・特別保留・即時の玉が二重に出ない、10,000歩で5枚・60分で6枚・特別保留は1日3つ、trust の掛け方、self は0
- [ ] Core のテスト: 即時の玉の量（受け取り時点の refPerSec）、燃料0でも入る、ストックは保留満タン・大当たり中・電サポ中も失われず空きに入る（自動補充より先）、snapshot→restore と1秒刻みの一致
- [ ] ゴールデンが変わる場合は更新して hash を DECISIONS に
- [ ] `scripts/test.sh core`・`scripts/test.sh all`・`scripts/build.sh` が通る

### P7-T9 即時報酬と特別保留の画面
Owner: Claude Code | Read: spec/40（画面）, spec/30（変換）
Do: 受け取り確認に「増える玉 生産◯時間ぶん ≈ ◯玉」（Projection の refPerSec で見込み）・メダル・特別保留。確定後のトーストは granted の balls。
行動タブの「今日の上限までの残り」に即時の玉・メダル・特別保留。HUD に特別保留のストック数。液晶の保留で serial が 1.5e9 台なら「特」の札。
記録の日別に即時の玉・特別保留、パチンコ統計に大当たりボーナスの合計。
Accept:
- [x] ヘッドレス Chrome（Debug の Grant 注入）で受け取り確認・HUD・保留の札・記録を確認
- [ ] `scripts/test.sh all`・`scripts/build.sh` が通る。実機: ショートカットとチェックインで受け取ると、確認画面の見込みどおりに持ち玉が増える

### P7-T10 試算とバランス目標の確認
Owner: Claude Code | Read: spec/23（バランス目標）
Do: `scripts/sim.sh econ` を standard/none/heavy × 3機種 × 7日・4週・12週で回し、玉の内訳（役物/大当たり/行動）・覚醒・初閉店・常連P・EV を表にする。
人間が決めた換算値（大当たりボーナス・即時の玉・メダルの枚数と値段）は変えない。閉店の条件（`required_run_total`・`divisor`）など他の値は、
玉が増えて閉店の目標を外れる時だけ直して DECISIONS に書く。`econ.test.ts` の判定を新しい目標に揃える。
Accept:
- [ ] spec/23 のバランス目標の判定を sim が出す。内訳が 大当たり 25〜45%・行動 25〜45% を外れたら、内訳と原因を STATUS の Blockers に書いて人間の判断を待つ
- [ ] `scripts/test.sh all`・`scripts/build.sh` が通る

---
## 行動を増やす（9/28 人間, D-082・D-083）

### P7-T11 階段（上った階数）
Owner: Claude Code | Read: spec/31, spec/30（変換・差分方式）
Do: `parseShortcutCode` に任意項目 `fl`（無ければ0、範囲外は捨てて警告）。`planGrants` に kind `flights`（10階ごとメダル +1、30階まで。燃料・即時の玉なし。
JSON `claims.flights` {`medal_per`: 10, `to`: 30}）。`resources/shortcut/README.md` の作り方に「上った階数」の検索とヘルスケアの許可を足す。受け取り確認と記録に階数。
Accept:
- [ ] claims のテスト: fl ありと無し（旧ショートカット）のコード、差分方式、3枚で止まる
- [ ] `scripts/test.sh all`・`scripts/build.sh` が通る
- [ ] 実機（人間）: ショートカットに階数の検索を足し、3日分の階数がヘルスケアアプリの表示と一致し、受け取るとメダルが増える。読めなかったら Blockers に書いて止まる

### P7-T12 遠征（距離の累計で店を開ける）
Owner: Claude Code | Read: spec/30（遠征）, spec/40（行動）
Do: JSON `claims.expedition` {`step_m`: 42195, `medals`: 10, `shops`: [{id `ekimae` 駅前店 light-middle-01}, {id `kokudo` 国道店 rush-middle-01}, {id `minato` 港町店 lt-middle-01}]}。
claims に `expeditionOf` と、`planGrants` での `expedition:<n>` の記録（distance の直後）。行動タブに遠征のカード（累計km・次の店までの km・開けた店と台）、到達時は受け取り確認に出す。
Accept:
- [ ] claims のテスト: 1回の受け取りで2回越えると2件、同じ日を受け取り直しても増えない、3回目以降はメダルだけ、店の並び
- [ ] `scripts/test.sh all`・`scripts/build.sh` が通る。ヘッドレス Chrome（Debug の Grant 注入で距離を入れる）でカードと到達の表示

### P7-T13 新台入替（閉店時の機種選択）
Owner: Claude Code | Read: spec/22（新台入替）, spec/23（閉店）, spec/40（強化）
Do: Core の `EngineConfig.machines`・close の `machineId`（rejected 'busy'/'machine'）・snapshot の機種 id・Projection の `machineId`。web の engine-build で3機種を渡し、
閉店のシートに「次の周回の台」（`expeditionOf` の開けた店だけ）を出す。液晶・HUD の round（D-077）は Projection の machineId から引く。記録の閉店履歴に機種。
Accept:
- [ ] Core のテスト: 切り替え後の抽選が新しい機種の表になる、大当たり中・電サポ中は rejected、無い id は rejected、特別保留のストックは残る、restore と1秒刻みの一致、ゴールデン不変
- [ ] `scripts/test.sh core`・`scripts/test.sh all`・`scripts/build.sh` が通る。実機: 遠征で開けた台に入れ替えて閉店し、その台で打てる
