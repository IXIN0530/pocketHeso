# 43 Presentation Effects: 音・光・振動
（旧 native-v1 spec/43 を Web に移植。CueSheet の考え方（D-007）と光過敏の安全策（旧 D-009 の後半）は継続）

## 目的
実機パチンコのような音・派手な光（虹フラッシュ等）・振動を、**コードを変えずにデータで足し引き・強弱調整**できるようにする。

## Web でできること
| 手段 | 可否 | 備考 |
|---|---|---|
| 音 | ◎ Web Audio（BGM/SE/ボイスのバス） | 最初のユーザー操作で解錠。消音スイッチ中は iOS が鳴らさないことがある（実測, P0-T5） |
| 光 | ◎ Three.js の加算シェーダ（虹、フラッシュ）、emissive のランプ、短時間のブルーム、パーティクル | 画面内のみ。背面ライト・画面輝度は不可 |
| 振動 | △ Android の `navigator.vibrate` のみ | iOS は no-op |
| 背面・通知 | × | 演出は前面のみ。留守中の当たりは復帰時にリプレイ（spec/22 AwaySummary） |

## CueSheet（`packages/shared` の純データ型）
```json
{"pattern": "spsp_gekiatsu", "cues": [
  {"at": 0,     "kind": "sound",  "bus": "bgm", "asset": "sp_reach_loop"},
  {"at": 41200, "kind": "flash",  "style": "rainbow", "ms": 800, "min_intensity": 2},
  {"at": 41200, "kind": "sound",  "bus": "se",  "asset": "kyuin"},
  {"at": 41200, "kind": "haptic", "pattern": [80, 40, 120]}]}
```
- `kind`: `sound` / `flash` / `particle` / `haptic` / `shake` / `bloom` / `camera` / `lcd`。未知の kind は無視（前方互換）。
  `lcd` は `{scene, ms, text?, color?}` で液晶の演出シーン（`reach` `sp` `climax` `pseudo` `group` `blackout` `kakutei` `kirin` `telop` `cutin`, D-067）。
  変動パターンのシートの時刻は patterns.json の `ms` 基準で書き、実際の変動時間（変動短縮など）に合わせて伸縮する。
  `bloom` は `{ms, strength}` で数秒だけブルームを ON（常時は重い, spec/50）。`camera` は `{shot, ms}` で寄り・引き、終了後は定位置へ戻す。
- `min_intensity`: 設定の強度（1〜3）未満ならスキップ。
- 分岐（群予告の有無など）は `RNGStream(seed, 'presentation', serial)` で決める → 同じ seed で同じキュー列。
  **Core の抽選結果には触れない**。
- 演出パック `resources/packs/<name>/`: `pack.json`（CueSheet 群・テーマ色）/ `sounds/*.m4a` / `sprites/*.png`。
  MVP は `default` のみ。SW がプリキャッシュ。

## 保留変化（D-072, D-075）
- 最終色は Core が取得時に決める（spec/21）。見せ方は `planHoldChange`（@ph/fx）が `RNGStream(seed, 'holdChange', serial)` で決める（当否は見ない）:
  先バレ（D-074）: 最終色だけで 青10%・緑18%・赤24%・金35% の保留が先バレする（色の信頼度は変わらない）。通常時の表で信頼度 約40%・出現 約1/580（light 1/333）。
  先バレしなかった保留のうち変化で見せる割合 青20%・緑35%・赤45%・金55%。先バレも変化で見せる。
- 抽選カスタム（P13-T1, D-110, P13-T8b, D-116, P13-T8c, D-117。設定 `prefs.sakibareCustom`）: 「通常」は上の色で決める先バレ。`sb40`/`sb90`/`sb100` は信頼度 r = 40/90/100%・占有率 o = 95/90/60% を狙い、
  当否・取得時のモード（`modeAtDraw`）の当選確率 p と保留色の重みで引く（`planHoldChangeCustom`。乱数は `'holdChange'` の3番目の値）。**先バレした保留は必ず変化保留**（灰色 → 自分の変動開始で割れて最終色。最終色は Core のまま）。
  白以外の保留を先に使い、足りない分（ST・LT の sb40・sb90）は最終色が白の保留にも先バレして、割れて色が出る（見せる色は `'holdChange'` の4番目の値で、見せた色の信頼度が表のままになる重み。Core の色・熱さ・Projection は白のまま）。
  r・o は全モードでカスタムの値（`customSakibareRates`。表: docs/state/sakibare-occ-20261021.md, P13-T8c, D-117）。
  特別保留・ボーナス保留は対象外。取得時の設定で決まる（変更は次の保留から）。
- 変化する保留（D-075, D-076）: 灰色（白）で出て点滅する（2.0回/秒、白い後光は大きめ）。消化されても灰色のまま、自分の変動開始から `HOLD_BREAK_MS` で割れる:
  0〜1350ms 次の保留の位置（当該保留のすぐ左, D-078）から液晶の中央へ動いて大きなパチンコ玉（半径は液晶の高さの0.3）になる（周りは暗く）→ 1800ms から点滅が 2.9回/秒へ速くなって震え、
  `HOLD_CRACK_STEPS_MS`（1950〜4280ms の7回、間が詰まる）にひびがピキッと一段ずつ伸びて網になる →
  4500ms 割れて殻が飛び、中から最終色の保留が出る。保留の色の輪が液晶の中心から広がり、画面全体にも `wash_<色>`（FlashLayer, 起点は画面上の液晶の中心）が広がる →
  5000ms 図柄が回り始める（変動の演出の起点もここ。尺は残りの変動時間に縮める）→ 5400ms までに保留が当該保留の位置へ戻る。
  短い変動は `holdBreakScale(変動時間)` で全体（液晶・hold_crack の音の時刻）を縮め、割れた後に図柄が 1200ms 回るようにする（縮尺の下限 0.15。5秒の変動で 0.76）。
  灰色の点滅保留は通常時の表で 信頼度 約37%・出現 約1/238（light 1/136）・当たりの約54%に付く（ST・LT の表では約43%・1/56）。
  先バレは取得の +150ms に `sakibare`（音・光・振動）が鳴り、見た目は灰色の点滅保留（割れるのは変動開始）。
- 音: 変動開始に `hold_crack`（玉になる音・ひびの音と小さな振動。ひびの音は `HOLD_CRACK_STEPS_MS` と同じ時刻）、割れた時に `hold_<色>`（割れる音・色の音・`wash_<色>`・振動、赤金は揺れ）。
  どちらも変動の演出と重ねて別の口で鳴らす（先バレに消されない）。倍速では液晶だけ。
- ヘソ入賞: 玉が入った瞬間にパックの `heso`（小さな正弦波の2音「ピロン」、音だけ）。先バレ・保留変化とは別の口で重ねて鳴らす（倍速では鳴らさない）。
- 液晶は `shownLcdState` で見せる色（blink・breaks 付き）に置き換えて描く。reduced-motion では点滅・震え・きらめきを止める（割れる流れは残す）。
- 留守中リプレイ・演出プレビューは取得時刻が分からないので先バレは鳴らさない。割れる演出は変動開始の時刻から同じに見せる。Debug のプレビューは「保留が割れる」で必ず割れる。

## 大当たり中の液晶（D-077）
- 液晶の上に 2D Canvas の表示（`hud-canvas.ts`）を重ね、図柄を暗くする。中身は `jackpotHud(LcdState, 表示時刻, 機種の round)` が決める（`jackpot-hud.ts`, Three・DOM なし）。
- 始めの 2.6秒は「大当たり」「nR」（RUSH 中は「RUSH n連目」）。その後は ROUND n / 全ラウンド・アタッカーに入った玉（1ラウンド count 個、ラウンドの8割で入る）・獲得出玉（(済んだラウンド×count＋入った玉)×payout_per_ball×レート）。RUSH 中の当たりは左上に「RUSH n連目」。
- 上乗せ（LT）は「上乗せ +nR」を3秒。2ラウンド目からの各ラウンドの始めに `round`、上乗せで `uwanose` を鳴らす。
- 大当たりの終わり（同じ時刻のモード変更で決める）と RUSH の回数切れで結果を 4.5秒出す（次の変動に重ねる）:
  RUSH突入（回数・出玉）/ LT突入 / RUSH継続（n連・RUSH の出玉の合計）/ RUSH終了（n連・合計）/ 時短突入 / 大当たり終了（出玉）。音は `rush_in`・`rush_on`・`rush_end`・`bonus_end`。
- 連チャンは RUSH に入った当たりを1連と数える（Projection に揃えた時は Core の chain + 1、出玉の合計は chainBalls の目安）。倍速では液晶だけ（音は鳴らさない）。

## 上位RUSH・上乗せ（rush-middle-01, D-120）
- Core が当否・上位・上乗せ回数 K を決める（HoldEntry / `jackpotStarted` の `upper`・`loops`）。見せ方は `planUpperRush`（@ph/fx）。乱数は `RNGStream(seed, 'presentation', serial)` の 64 番目以降で、当否には触れない。機種の枝は `upperRushSpec`。
- ガセ: 上位でない ST 中の当たりに `UPPER_GASE_RATE` = 10%（初当たり・light・lt には出さない）。白黒になった時の上位の信頼度は約77%。
- 当たる数字 3/2/1/0 の重み q(1−q)^i（q = 1 − (1 − 1/loop_1_in)^(1/4)）= 27.8/25.8/24.0/22.4%。K < loop_max なら最後の回は外れ（4つ全部見せて「上乗せ終了」）、K = loop_max は最後の当たりの後に「上乗せ MAX」。
- 時刻表（大当たり開始からの ms）:

| 時刻 | 内容 |
|---|---|
| `UPPER_FREEZE_MS` 5000 | フリーズ。300ms（`UPPER_GRAY_IN_MS`）で白黒 |
| `UPPER_CRACK_STEPS_MS` 6000, 6840, 7550, 8060, 8450, 8770, 9000 | ガラスのひびの各段 |
| `UPPER_GASE_BACK_MS` 7000 | ガセはここから 600ms（`UPPER_GRAY_OUT_MS`）で色が戻る |
| `UPPER_BREAK_MS` 9600 | 割れて「上位RUSH突入！」「+10R」を虹で 3500ms（`UPPER_IN_SHOW_MS`）。全ラウンド 10R→20R、出玉の横に「+1,500」 |
| `UWANOSE_START_MS` 13100 | 「上乗せスタート！」1500ms |
| 14600 + 5000×i（`UWANOSE_SLOT_MS`） | i 番目の数字 |
| 当たりの数字の +2000 | 割れて「上乗せ +10R！」3000ms。全ラウンド +10。その 1000ms 後に次の「上乗せスタート！」 |
| 外れの「0」の +5000 | 「上乗せ終了」1500ms → 600ms で色が戻る |
| K = 4: 最後の当たりの告知の +1000 | 「上乗せ MAX 60R」3000ms → 色が戻る |

- 白黒は液晶だけ（盤面・HUD の外・ボタンは色のまま）。白黒の間は図柄・大当たり中の表示とも彩度0。HUD の数字はフリーズ時刻の値で止まり、ラウンドは Core の時刻どおり裏で進み、色が戻ると追いつく。見せる全ラウンドはいつも今のラウンド＋1 以上（最後のラウンドを除く。合計で頭打ち）。
- 縮め方: 色が戻りきる時刻が「大当たりの長さ − 結果表示 4,500ms」を超える時は、導入（`UPPER_INTRO_MS` 2600ms）より後を一様に縮める（下限 `UPPER_MIN_SCALE` 0.25）。それでも足りなければ数字のカウントダウンを省き、当たりだけ順に見せる（`upperTimeline`）。見え方は `upperViewAt`（gray・frozen・crack・shatter・banner・addedRounds）で、`jackpotHud` の round の `upper` に入る。
- 結果表示: 上位の当たりの終わりは「上位RUSH継続」（n連・合計, `LcdResult.upper`）。上位の後の ST 中の残り回数の表示を「上位RUSH」にするのは Projection の `rushUpper`（画面は P15-T5）。
- キュー（`UPPER_CUES` / `upperCues`。中身は P15-T4）: `upper_freeze`・`upper_crack`（ひびの各段）・`upper_in`（割れて突入。虹の wash・振動・揺れ）・`uwanose_start`・`uwanose_tick`（数字ごと）・`uwanose_hit`（虹の wash・振動）・`uwanose_end`（終了・MAX）。ガセは `upper_freeze` だけ。倍速では液晶だけ（音は鳴らさない）。
- reduced-motion: 揺れ・破片・虹のきらめきを止める（白黒・ひび・文字の流れは残す）。フラッシュは 1秒に3回以下（光過敏の安全策）。
- 用語: 港町店（lt）の「上位 RUSH（ラッキートリガー）」とは別物。モードは増やさず、枝の印 `upper` で持つ。

## レンダラ（`packages/fx`）
| 型 | 役割 |
|---|---|
| `CuePlayer` | CueSheet を SimTime 同期で実行。途中から再生できる |
| `SoundBus` | Web Audio。バス `bgm` `se` `voice`、バス別音量。デコード済みバッファをキャッシュ |
| `FlashLayer` | Three の最前面の全画面クアッド（加算シェーダ）。虹・白フラッシュ。ブルームの ON/OFF もここで仲介 |
| `Haptics` | `navigator.vibrate` があれば実行、なければ no-op |

## 設定
| キー | 既定 | 内容 |
|---|---|---|
| `fx.intensity` | 2 | 1 控えめ / 2 標準 / 3 派手 |
| `sound.volume.{master,bgm,se,voice}` | 0.8 | バス別音量。`master = 0` がアプリ内ミュート |
| `fx.haptics` | on | 振動（対応端末のみ） |

## 光過敏の安全策（設定で外せない）
- フラッシュは 1秒あたり 3回以下にクランプ。全画面の急な明滅は輝度差を制限。
- `prefers-reduced-motion: reduce` の時は flash をフェードに置き換える。

## 素材
自作またはライセンス確認済みのフリー素材のみ。実機種の音・映像は使わない。
