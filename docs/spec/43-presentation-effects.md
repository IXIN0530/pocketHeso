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

## 保留変化（D-072）
- 最終色は Core が取得時に決める（spec/21）。見せ方は `planHoldChange`（@ph/fx）が `RNGStream(seed, 'holdChange', serial)` で決める:
  先バレ（D-074）: 最終色だけで 青10%・緑18%・赤24%・金35% の保留が先バレする（当否を見ないので色の信頼度は変わらない）。
  通常時の表で先バレの信頼度は約40%・出現は約1/580（light 1/333）・当たりの約24%に付く（ST・LT の表では約46%・1/139）。
  先バレは白で出て、取得の +150ms に `sakibare`（音・光・振動）、取得時の変化（+700ms）で最終色へ上がり `hold_<色>` が鳴る。
  先バレしなかった保留のうち変化で見せる割合 青20%・緑35%・赤45%・金55%。始まりの色は最終色より下（白4:青2:緑1:赤1）、2色以上離れていれば40%で2段階。
  変わる時点は 取得時（+700ms）/ 前の保留が消化された時（+350ms）/ 自分の変動開始時（+500ms）。消化が来ないまま番が来たら変動開始時に変える。色は上がるだけで最終色を超えない。
- ヘソ入賞: 玉が入った瞬間にパックの `heso`（小さな正弦波の2音「ピロン」、音だけ）。先バレ・保留変化とは別の口で重ねて鳴らす（倍速では鳴らさない）。
- 液晶は `shownLcdState` で見せる色に置き換えて描く。変わった時に保留が光り、パックの `hold_<色>`（音・光・振動）を変動の演出と重ねて鳴らす（倍速では鳴らさない）。
- 留守中リプレイ・演出プレビューは取得時刻が分からないので、取得時・消化時の変化は済んだ色から始め、変動開始時の変化は同じ時刻に同じ色で見せる（先バレも済んだものとして鳴らさない）。

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
