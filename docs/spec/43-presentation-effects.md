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
