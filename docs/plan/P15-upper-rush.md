# P15 v1.6 国道店（rush-middle-01）の上位RUSH と上乗せ（人間の要望 10/22）
目的: リゼロ2のように、RUSH 中の当たりの一部を**上位RUSH**（3,000発＋上乗せのループ）にする。上位に入る時と上乗せの時は、液晶が白黒でフリーズし、ガラスが割れて虹色で知らせる演出を付ける。
`dev` で開発し、人間が dev プレビューで確認してから `main` に出して `v1.6.0` にする（D-019）。

人間の要望（10/22）と決まったこと:
| # | 要望・質問 | 決定 |
|---|---|---|
| 1 | RUSH 中の当たりの 25% で上位RUSH。通常 1,500発、上位 3,000発 | RUSH 中（ST 中）の当たりだけ。初当たり（3R → RUSH 突入）は今のまま。上位かどうかは RUSH の当たりごとに抽選し直す |
| 2 | 上位ではさらに 25% で +1,500発が乗り続ける | 当たれば次の上乗せ抽選へ進み、外れるまで続くループ。1回の当たりは合計 60R まで（10R＋上位 10R＋上乗せ最大4回 = 9,000発）。4回目まで続く確率は約0.4% |
| 3 | 上乗せは「3、2、1、0」の4回の抽選。1回あたり 0.25 の 1/4 乗 | **4回のどこかで当たる合計が 25%**（1回あたり 1 − 0.75^(1/4) ≈ 6.94%）。Core が 25% で当否を決め、どの数字で当たるかは演出側が決める |
| 4 | 上位で変わるもの | その当たりの出玉だけ。次の ST の確率・回転数は通常の RUSH と同じ。上位の当たりの後の ST 中は液晶に「上位RUSH」と出すだけ |
| 5 | 期待値が +29% 上がる（10.5 → 約13.6玉/回転） | **RUSH の回転数を 75 → 66 回に減らして揃える**（継続率 85.1% → 81.3%。理論値 10.63玉/回転。T2 で実測） |
| 6 | 白黒にする範囲 | 上位・上乗せとも**液晶だけ**（盤面・HUD・ボタンは色のまま）。ひびも液晶のガラスに入る |
| 7 | ガセ（白黒・フリーズしたのに割れない） | **入れる**。通常の RUSH の当たりの 10% で白黒・フリーズまで出て、割れずに戻る（白黒になった時に上位になる信頼度は約77%） |

- 順番: T1 → T2 → T3 → T4 → T5 → T6 → T7。T3 は T1 の型（jackpotStarted・Projection の項目）にだけ依存する。T7 は人間の指示がある時だけ。
- レビューは `/review P15-Tn` を書いた側と別のエージェントで。
- 名前に注意: 港町店（lt-middle-01）の `lt` モードも spec/21 で「上位 RUSH（ラッキートリガー）」と書かれている。本フェーズの上位RUSH は**振り分けの枝の印**（`upper`）で、モードは増やさない。コードでは `upper`、画面の文字は「上位RUSH」。

## 数値（rush-middle-01、T1 で JSON に入れ T2 で実測）
- RUSH 中の振り分け: 10R（1,500発）75% / 上位 20R（3,000発）＋上乗せ 25%。
- 上乗せ: 1回 +10R（+1,500発）、`1/4` で次へ、最大4回。上乗せの回数 K の分布は P(K ≥ k) = 0.25^k（k ≤ 4）、E[K] = 0.332。上位の当たりの平均 約3,498発。
- RUSH 中の当たり1回の平均: 0.75 × 1,500 + 0.25 × 3,498 = 約2,000発（今は 1,500）。
- RUSH: 1/39.9 × 66 回、継続率 81.3%。RUSH に入ってからの当たりの平均回数 4.34（今は 5.71）。
- 通常1回転あたりの期待出玉（理論値）: 10.63玉（今は 10.51、light 10.52・lt 10.39）。66 回が一番近い（65 回は 10.35）。
- どの数字で当たるか（当たりの時だけ、演出側）: q = 1 − 0.75^(1/4) として 3 / 2 / 1 / 0 が q(1−q)^i に比例 = 27.8% / 25.8% / 24.0% / 22.4%。

### P15-T1 Core: 上位の枝・上乗せのループ・RUSH 66 回
Owner: Claude Code（Opus） | Read: spec/21-core-lottery（機種 JSON・振分けの枝・上乗せ・乱数・出玉）, spec/22-core-engine（イベント・HoldEntry・Projection・snapshot・決定論契約）
Do:
- 機種 JSON の枝に任意の `upper`（spec/21 の振分けの枝の節に書く）:
  ```json
  { "kind": "kakuhen", "weight": 0, "weight_st": 25, "rounds": 10, "bonus_rounds": 10,
    "upper": { "add_rounds": 10, "loop_1_in": 4, "loop_max": 4 } }
  ```
  - `bonus_rounds` は上位で増える分（+10R）。`upper` の付いた枝は、取得時に上乗せの回数 K（0〜`loop_max`）を引き、出玉と大当たりの時間は `rounds + bonus_rounds + add_rounds × K` ラウンド分。
  - 検証: `add_rounds` ≥ 1、`loop_1_in` > 1、`loop_max` ≥ 1、`rounds + bonus_rounds + add_rounds × loop_max` ≤ 60（今の合計ラウンドの上限）。`upper` の付いた枝は `next` が `st` のもの（RUSH に戻る枝）だけ。重複の判定に `upper` の有無を足す。
- K の抽選（取得時に確定, D-017）: 新しい乱数ストリーム `uwanose`（`RNGStreamID` に追加。既存のストリームの値が変わらないことをテストで確かめる）。
  `RNGStream(seed, 'uwanose', serial)` から `loop_max` 回まで `nextU32()` を引き、閾値 `floor(2^32 / loop_1_in)` 未満なら K+1 して続け、以上なら止める（`jackpot_1_in` と同じ閾値の作り方）。外れの保留・upper でない枝では引かない。
- 型とイベント（spec/22 を直す）:
  - `HoldEntry` に `upper?: true`・`loops?: number`（上位の時だけ。snapshot にも入る）。
  - `jackpotStarted` に `bonusRounds`（spec/21 にある項目。合計の上乗せ = `bonus_rounds + add_rounds × K`）・`upper?: true`・`loops?: number`。`rounds` は基本の 10 のまま。
  - 上位の枝では `uwanose` イベントを**出さない**（見せる時刻は fx が決める, T3）。LT の上乗せは今のまま。
  - `jackpotEnded.payout` は合計ラウンドの出玉。
- Projection: `JackpotView` に `upper`・`loops`・合計ラウンド（既にあればそれ）。`HallProjection.rushUpper: boolean` = 上位の当たりが終わってから、次の `jackpotStarted` か ST を抜けるまで true。状態は snapshot に入れる（false なら省略して golden 不変）。
- `resources/machines/rush-middle-01.json`: RUSH 中の 10R 確変の `weight_st` を 100 → 75、上の上位の枝を足す、`modes.st` を 66 回（`st_spins` か `spins`、今の書き方に合わせる）、`version` を 2 に。
  旧セーブで ST の残りが 66 を超えていてもそのまま数え下ろす（切り詰めない）。
- spec/21: 振分けの枝に `upper`、乱数のストリームに `uwanose`、rush-middle-01 の数値（本ファイル「数値」の節。T2 の実測で書き直す）。spec/22: 上の型・イベント・Projection。DECISIONS に D-120（上位の枝・25% の当否は Core・どの数字かは fx・66 回で期待値を揃える, 人間判断 10/22）。
- テスト（core）: `upper` の parse と検証（60R 超え・next が st でない・不正な値はエラー）／K の分布（1万回で P(K≥1)≈0.25±0.01・P(K≥2)≈0.0625±0.005・K ≤ 4）／
  出玉 = 合計ラウンド × count × payout_per_ball × unit／大当たりの時間が合計ラウンド分／上位の枝で `uwanose` が出ない／`rushUpper` の立ち下がり（次の当たり・ST 終了）／
  restore と1秒刻みの一致（上位の大当たり中・上位の後の ST 中で snapshot）／light・lt と golden 不変。
Accept:
- [ ] `scripts/test.sh core` が通る（golden 不変）

### P15-T2 試算: 期待値と週の伸び・台のスペック表示の数値
Owner: Claude Code（Opus） | Read: spec/21-core-lottery（出玉・期待値）, spec/23-core-economy（バランス目標）, ref/tooling（pachisim）
Do:
- pachisim の `sim run` の理論値が `upper` を数える（上位の平均ラウンド = `rounds + bonus_rounds + add_rounds × E[K]`、E[K] = Σ_{k=1..max} (1/loop_1_in)^k。pachisim は Core ではないので `Math.pow` 可）。
- 測る: `sim run`（rush の理論値 ≈ 10.63）・`sim econ --ev-hours 1000`（60 seed。rush の EV が light・lt と ±0.03 以内か。今は 3台とも約1.10）・上乗せの実測分布（上位の割合 25%・K の分布・1回の当たりの最大 9,000発）・
  P10-T5 と同じ週の伸びの検証（`--tree all`・rush。今の基準と D-115 の持ち越しと比べる）・`sim holds`（ST の回転数が変わっても保留の信頼度・出現が許容内か）。
- 結果を `docs/state/econ-YYYYMMDD-p15.md` に（前後の表）。EV が ±0.03 を外れたら、66 の前後（64〜68 回）を試し、一番近い回数を推奨として**止まって人間に聞く**（勝手に変えない）。
- spec/21 の rush の数値（継続率・期待出玉・RUSH 中の当たりの平均）を実測で直す。
- 台のスペック画面の数値（`apps/web/src/engine/machine-spec-view.ts`、web の純関数）: 電チュー（RUSH 中）の円グラフに上位の扇（「20R＋上乗せ」「約3,000〜9,000個」25%）、
  基本性能の表に「上位RUSH 25%・上乗せ 1/4 でループ（最大 +40R）・RUSH 中の当たりの平均 約2,000個」、RUSH 継続率は 66 回の値。ゲームフローに「RUSH 当たり → 上位RUSH（25%）」の注記。テストのスナップショットを更新。
Accept:
- [ ] `scripts/test.sh all`・`scripts/build.sh` が通る
- [ ] rush の EV が light・lt と ±0.03 以内（外れたら人間の判断待ちで Blockers に）

### P15-T3 fx: 上位・上乗せの見せ方の計画と液晶の時刻表
Owner: Claude Code（Opus） | Read: spec/43-presentation-effects（保留変化・大当たり中の液晶・光過敏）, spec/22-core-engine（jackpotStarted・Projection の jackpot）
Split: Opus — `planUpperRush` と `jackpotHud` の時刻表・テスト / Sonnet — spec/43 の節を書く
Do:
- `planUpperRush(jackpot, seed): UpperPlan`（@ph/fx、純関数。Three・DOM なし。乱数は `RNGStream(seed, 'presentation', serial)` の決まった番目。当否には触れない）:
  - 上位でない RUSH 中の当たり（ST 中に引いた当たりで `upper` なし）: 10%（定数 `UPPER_GASE_RATE`）で `gase`。それ以外は何もしない。初当たり・light・lt には出さない。
  - 上位: 上乗せの回数 `loops`（Core の K）ぶん、各回で当たる数字 i（0〜3 = 3/2/1/0）を q(1−q)^i の重み（q = 1 − (1 − 1/loop_1_in)^(1/4)、fx なので `Math.pow` 可）で選ぶ。
    K が `loop_max` 未満なら最後の回は外れ（4つの数字を全部見せて「上乗せ終了」）。K = `loop_max` なら最後の当たりの後に「上乗せ MAX」で終わる（外れの回は見せない）。
- 液晶の時刻表（大当たり開始からの ms、定数で持つ。`jackpotHud` が返す状態に足す）:
  | 時刻 | 本物（上位） | ガセ |
  |---|---|---|
  | 0〜2,600 | 今の導入（大当たり・10R・RUSH n連目, 虹） | 同じ |
  | 5,000 | `UPPER_FREEZE_MS`: 300ms で液晶を白黒に、HUD の数字が止まる（フリーズ）。ラウンドの音を止める | 同じ |
  | 6,000〜9,000 | `UPPER_CRACK_STEPS_MS`: 7回（間が詰まる）液晶の中央から外へひびが一段ずつ広がって網になる | 7,000 から 600ms で色が戻り、HUD が実際の値へ追いつく（ひびは入らない） |
  | 9,600 | `UPPER_BREAK_MS`: ガラスが割れて破片が飛び、虹の `wash` が液晶の中心から広がる。「上位RUSH突入！」「+10R」を虹色で 3,500ms。全ラウンドの表示が 10R → 20R、獲得出玉の横に「+1,500」 | — |
  | 13,100 | `UWANOSE_START_MS`: 液晶を白黒に、「上乗せスタート！」1,500ms | — |
  | 14,600 + 5,000 × i | 大きな数字 3 / 2 / 1 / 0（`UWANOSE_SLOT_MS` = 5,000） | — |
  | 当たりの数字の +2,000 | 数字が割れて虹の「上乗せ +10R！」3,000ms、全ラウンド +10。その 1,000ms 後に次の「上乗せスタート！」 | — |
  | 外れの回の「0」の +5,000 | 「上乗せ終了」1,500ms → 色が戻り、ふつうの大当たり中の表示へ | — |
  | K = 4 の最後の当たりの後 | 「上乗せ MAX 60R」3,000ms → 色が戻る | — |
  - 液晶の白黒の間は、図柄・大当たり中の表示（ROUND・玉数・出玉）とも彩度 0。数字と文字は液晶いっぱいに大きく（白、虹の時だけ虹色）。白黒の間もラウンドは Core の時刻どおり進み、戻った時に HUD が追いつく。
  - 表示中の全ラウンドは、いつも今のラウンド＋1 以上（ms_per_round 5,000 なら K = 4 でも足りる。テストで確かめる）。
  - 時刻表の終わりが「大当たりの終わり − 4,500ms（結果表示）」より後になる時（Debug・強化で短い時）は、全体を縮める（下限 0.25）。それでも足りなければ数字のカウントダウンを省き、当たりだけ順に見せる。
  - 大当たりの終わりの結果表示: 上位の当たりは「上位RUSH継続」（n連・合計）。上位の後の ST 中は、RUSH の残り回数の表示を「上位RUSH」に（Projection の `rushUpper`）。
- 音・光のキュー（パックの名前。中身は T4）: `upper_freeze`（フリーズの重い音）・`upper_crack`（ひびの各段）・`upper_in`（割れて突入, 虹の wash・振動・揺れ）・
  `uwanose_start`・`uwanose_tick`（数字ごと）・`uwanose_hit`（虹の wash・振動）・`uwanose_end`。ガセは `upper_freeze` だけ。倍速では液晶だけ（音は鳴らさない, 今の規則）。
- reduced-motion: 揺れ・破片・虹のきらめきを止める（白黒・ひび・文字の流れは残す）。フラッシュは 1秒に3回以下（spec/43 の安全策）。
- テスト（fx・web の jackpot-hud）: 同じ seed で同じ計画／ガセの割合（1万回で 10%±1%）・上位にはガセが付かない／当たる数字の分布（27.8/25.8/24.0/22.4 ±1.5pt）／
  K = 0・1・4 の時刻表（各時刻の表示・全ラウンドの表示・「上乗せ MAX」）／全ラウンドの表示が今のラウンドより先／縮める時の時刻／light・lt・初当たりでは何も出ない。
- spec/43 に「上位RUSH・上乗せ（rush-middle-01）」の節（上の表・ガセ・キュー・縮め方）。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る

### P15-T4 web: 白黒・ひび・割れ・数字の描画と音、Debug のプレビュー
Owner: Claude Code（Sonnet） | Read: spec/43-presentation-effects（上位RUSH・上乗せの節・保留変化のひび）, spec/50-app-rendering（液晶・FlashLayer）
Do:
- 液晶の描画（`apps/web/src/board/hud-canvas.ts` と液晶の描画元）: T3 の状態を描く。白黒は今の液晶の描き方に合わせる（2D Canvas なら `filter: grayscale(1)`、テクスチャならシェーダの uniform。盤面・HUD・ボタンは色のまま）。
  ひびは保留が割れる演出（`HOLD_CRACK_STEPS_MS` の網）の描き方を液晶の大きさで使い、割れる時は破片を飛ばす。虹の文字は今の大当たりの導入の虹に合わせる。数字 3 / 2 / 1 / 0 は液晶の高さの 6 割くらい。
- 割れる時（`upper_in`・`uwanose_hit`）は FlashLayer の虹の `wash`（起点は画面上の液晶の中心）を重ねる。
- 音: 演出パック `default` に T3 のキュー7つ（今の `hold_crack`・`rush_on` などの作り方に合わせる。自作のみ）。フリーズの間はラウンドの音を止める。
- Debug の演出プレビュー（`stores/preview.ts`）に「上位RUSH（上乗せ 0 / 1 / 4 回）」「ガセ」を足す（必ずその流れになる）。
- 留守中リプレイ: リプレイする当たりが上位なら同じ流れで見せる（`planUpperRush` は同じ seed・serial なので同じ）。
- spec/43・spec/50 の該当箇所を直す（描画の方法だけ）。
- テスト（web）: プレビューの4つが出る・上位の大当たり中に液晶だけ白黒（盤面の描画は変えない）・reduced-motion で破片と揺れが止まる。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機は T6 でまとめて確認

### P15-T5 文言と画面の残り
Owner: Claude Code（Sonnet） | Read: spec/40-app-ui（ホール・記録・設定）
Do:
- ホールの RUSH 中の表示（残り回数の行など）を `rushUpper` の時「上位RUSH」に。記録の大当たり履歴（あれば）に上位と上乗せの回数（例「上位 +2」）。
- `machine-info.ts` の国道店の一言を上位RUSH が分かる文に（仮でよい。人間が後で直せる形のまま）。
- spec/40 の該当箇所を直す。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る

### P15-T6 実機確認
Owner: 人間（手順は Claude Code（Sonnet）） | 前提: P15-T1〜T5
Do: `dev` を push し、人間に手順を渡す（Debug の演出プレビューを使ってよい。等倍は `/?debug=1&sandbox=1`）:
1. 演出プレビュー「上位RUSH（上乗せ 0 回）」: 大当たり 10R の虹 → 約5秒で液晶だけ白黒・フリーズ → ひびが広がる → 割れて「上位RUSH突入！+10R」 → 「上乗せスタート！」→ 3・2・1・0 → 「上乗せ終了」→ 色が戻る。
2. 「上乗せ 1 回」: どこかの数字で割れて「上乗せ +10R！」→ もう一度「上乗せスタート！」→ 外れて終わる。全ラウンドの表示が 20R → 30R。「上乗せ 4 回」で「上乗せ MAX 60R」。
3. 「ガセ」: 白黒・フリーズのあと割れずに色が戻る。
4. 盤面・ボタンは色のまま。音（フリーズ・ひび・割れ・数字）が鳴る。消音・倍速では液晶だけ。
5. 国道店で実際に RUSH を打ち、上位の後の ST 中に「上位RUSH」と出る。設定 →「台のスペック」の国道店に上位の扇と RUSH 継続率 81%。
結果を STATUS Notes に。演出の秒数・文言の直しはここで出してもらい、T3/T4 の定数を直す（直しは `[P15-T6]` のコミット）。
Accept:
- [x] 実機（人間）: 上の 1〜5 が OK

### P15-T7 v1.6.0 のリリース（main へ）
Owner: Claude Code（Sonnet） | Read: ref/tooling（デプロイ） | 前提: **人間の「リリースしてよい」の指示**。T1〜T6 が OK
Do: P8-T6 の手順 1〜4 と同じ。ルート `package.json` の version を 1.6.0 にしてからタグ `v1.6.0`。
本番確認は: Debug が無い・バージョン v1.6.0・既存セーブで開ける（国道店で RUSH 中のセーブでも続きから打てる）・国道店の RUSH で上位・上乗せの演出が出る・台のスペックの国道店が新しい数値。
Accept:
- [x] `main` と `dev` が同じコミットで、`v1.6.0` タグが付いている
- [ ] 本番の確認が人間から OK
