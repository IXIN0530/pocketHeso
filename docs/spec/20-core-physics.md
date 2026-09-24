# 20 Core: Board & Physics & Outcome Atlas
（旧 native-v1 spec/20 を TS に移植。数値・形式は同じ）

## 単位と座標
- 長さ mm、時間 s（物理内部）/ ms（SimTime）。原点は盤面左上、+y が下。
- 玉: 直径 11.0mm（半径 5.5）。質量は計算に使わない（静的障害物のみ）。

## 盤面 JSON（`resources/boards/<id>.json`）
```json
{
  "id": "default", "version": 1,
  "size_mm": [420, 460],
  "gravity_mm_s2": 9000,
  "pins":     [{"p": [120.0, 80.0], "r": 1.1}],
  "segments": [{"a": [0,0], "b": [0,460], "restitution": 0.35, "friction": 0.1}],
  "sensors":  [{"id": "heso", "kind": "start1", "rect": [200, 300, 20, 8]},
               {"id": "out",  "kind": "out",    "rect": [0, 452, 420, 8]}],
  "launch": {"origin": [405, 440], "dir_table": "launch_dirs", "speed_mm_s": [3200, 3600]},
  "pin_restitution": 0.45, "pin_friction": 0.05,
  "yakumono": [{"id": "windmill", "p": [90, 140], "r": 14}]
}
```
- `sensors.kind`: `start1`（ヘソ）/ `out` / 将来 `start2` `attacker` `v`。
- `yakumono`: 経済の役物（spec/23）の**描画位置のみ**。物理には関与しない（回転する見た目だけ）。
- 方向は `dir_table`（事前計算した単位ベクトル表, 1024 件）の添字。実行時に `Math.sin/cos` を呼ばない。
- 盤面ハッシュ = 正規化 JSON（キーソート・小数6桁）の SHA-256。Atlas と紐付ける（Node は `crypto`、ブラウザは `crypto.subtle`）。

## 物理
- 固定ステップ `dt = 1/960 s`。最大速度 6000mm/s でクランプ（1ステップ移動 ≦ 6.25mm < 半径）。
- 衝突: 円(玉) vs 円(釘)、円 vs 線分。貫通時は法線方向に押し戻し → 反発係数・摩擦で速度更新。
- ブロードフェーズ: 一様グリッド（セル 16mm）。盤面ロード時に静的構築（`Int32Array`）。
- センサー: 玉中心が矩形に入った最初のステップで確定。`out` か `start1` で終了。20秒で `lost`。
- **使ってよい演算: `+ - * /`、`Math.sqrt`、比較、`Math.min/max/abs`**。IEEE 754 で結果が一意なものに限る。
  禁止: `Math.sin/cos/tan/atan2/exp/log/pow`、`**`、`Math.hypot`（実装依存で丸めが揺れる）。

## 初期条件（1発ごと）
`LaunchParams { dirIndex: number(0..1023), speedQ: number(0..65535) }`。
ハンドル位置（設定, 0〜1）で速度の中心を決め、`RNGStream('launchJitter')` で揺らぎを加える。

## API
```ts
export class BallSimulator {
  constructor(board: Board)
  run(p: LaunchParams): BallOutcome                                  // 最速。軌跡を保持しない
  trajectory(p: LaunchParams, every: number): TrajectorySample[]     // 描画用
}
export interface BallOutcome { kind: SensorKind; flightMs: number; steps: number }
```
**不変条件**: 同じ `LaunchParams` で `run` と `trajectory` の結果（kind, steps）が一致（内部ステップ関数を共有）。

## Outcome Atlas（D-003 の核）
- 各玉が独立なので結果は `LaunchParams` だけで決まる。
- 玉 i の LaunchParams を `RNGStream('launch', i)` で決め、量子化キーで引く:
  `key = dirIndex(10bit) << 6 | speedBucket(6bit)` → 65,536 エントリ。
- エントリ: `kind(u8) + flightMs(u16) + canonicalParams(4B)` = 7B → 約 450KB。ヘッダに版数・盤面ハッシュ・件数。
- 描画時は `canonicalParams` で `trajectory` を再計算（見た目と結果が必ず一致）。
- 生成: `pnpm sim atlas --board default` → `resources/atlas/default.<boardhash16>.bin`（コミットする）。
  Worker 並列で生成してもよいが、**結果は並列度に依存しない**こと。
- 初回起動時に先頭1024エントリをブラウザで再計算して照合。不一致なら警告表示＋`pachisim` 由来値を信用しない
  （Web Worker で全再生成、進捗表示）。

## 目標値
- ヘソ入賞率 5〜8%。平均滞空 3〜5秒。
- 性能: `run` を Node（M 系 Mac）単スレッドで 2,000発/秒以上。iPhone Safari で 500発/秒以上（照合用）。
