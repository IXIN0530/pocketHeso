# 43 Presentation Effects: 音・光・振動
（旧 native-v1 spec/43 を Web に移植。CueSheet の考え方（D-007）と光過敏の安全策（旧 D-009 の後半）は継続）

## 目的
実機パチンコのような音・派手な光（虹フラッシュ等）・振動を、**コードを変えずにデータで足し引き・強弱調整**できるようにする。

## Web でできること
| 手段 | 可否 | 備考 |
|---|---|---|
| 音 | ◎ Web Audio（BGM/SE/ボイスのバス） | 最初のユーザー操作で解錠。消音スイッチ中は iOS が鳴らさないことがある（実測, P0-T5） |
| 光 | ◎ Pixi のフィルタ（色相回転の虹、フラッシュ）、パーティクル | 画面内のみ。背面ライト・画面輝度は不可 |
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
- `kind`: `sound` / `flash` / `particle` / `haptic` / `shake`。未知の kind は無視（前方互換）。
- `min_intensity`: 設定の強度（1〜3）未満ならスキップ。
- 分岐（群予告の有無など）は `RNGStream(seed, 'presentation', serial)` で決める → 同じ seed で同じキュー列。
  **Core の抽選結果には触れない**。
- 演出パック `resources/packs/<name>/`: `pack.json`（CueSheet 群・テーマ色）/ `sounds/*.m4a` / `sprites/*.png`。
  MVP は `default` のみ。SW がプリキャッシュ。

## レンダラ（`packages/fx`）
| 型 | 役割 |
|---|---|
| `CuePlayer` | CueSheet を SimTime 同期で実行。途中から再生できる |
| `SoundBus` | Web Audio。バス `bgm` `se` `voice`、バス別音量。デコード済みバッファをキャッシュ |
| `FlashLayer` | Pixi の最前面コンテナ。虹は色相回転フィルタ |
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
