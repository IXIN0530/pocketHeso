# 20 Core: Board & Physics & Outcome Atlas

## 単位と座標
- 長さ mm、時間 s（物理内部）/ ms（SimTime）。原点は盤面左上、+y が下。
- 玉: 直径 11.0mm（半径 5.5）。質量は計算に使わない（静的障害物のみのため）。

## 盤面 JSON（`Resources/boards/<id>.json`）
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
  "pin_restitution": 0.45, "pin_friction": 0.05
}
```
- `sensors.kind`: `start1`（ヘソ）/ `out`（アウト）/ 将来 `start2` `attacker` `v`。
- 方向は `dir_table`（事前計算した単位ベクトル表, 1024 件）の添字で指定。実行時に sin/cos を呼ばない。
- 盤面ハッシュ = 正規化 JSON（キーソート・小数6桁）の SHA256。Atlas と紐付ける。

## 物理
- 固定ステップ `dt = 1/960 s`。最大速度 6000mm/s でクランプ（1ステップ移動 ≦ 6.25mm < 半径）。
- 衝突: 円(玉) vs 円(釘)、円 vs 線分。貫通時は法線方向に押し戻し → 反発係数・摩擦で速度更新。
- ブロードフェーズ: 一様グリッド（セル 16mm）。盤面ロード時に静的構築。
- センサー: 玉中心が矩形に入った最初のステップで確定。`out` か `start1` で玉の寿命終了。
- タイムアウト: 20秒で `lost`（アウト扱い）。
- 使ってよい演算: `+ - * / sqrt`、比較、`min/max/abs`。他は禁止（決定論, AGENTS.md）。

## 初期条件（1発ごと）
`LaunchParams { dirIndex: UInt16, speedQ: UInt16 }`（速度は `speed_mm_s` 範囲を 65536 分割）。
ハンドル位置（ユーザー設定, 0〜1）で速度の中心を決め、`RNGStream(.launchJitter)` で揺らぎを加える。

## API
```swift
public struct BallSimulator {
  public init(board: Board)
  public func run(_ p: LaunchParams) -> BallOutcome          // 最速。軌跡を保持しない
  public func trajectory(_ p: LaunchParams, every n: Int) -> [TrajectorySample] // 描画用
}
public struct BallOutcome { kind: SensorKind; flightMs: Int32; steps: Int32 }
```
**不変条件**: 同じ `LaunchParams` で `run` と `trajectory` の結果（kind, steps）は一致する。

## Outcome Atlas（D-003 の核）
- 各玉が独立なので、結果は `LaunchParams` だけで決まる。
- 玉 i の LaunchParams を `RNGStream(.launch, index: i)` で決め、Atlas に量子化キーで引く:
  `key = dirIndex(10bit) << 6 | speedBucket(6bit)` → 65,536 エントリ。
- エントリ: `kind(UInt8) + flightMs(UInt16) + canonicalParams(4B)` = 7B → 約 450KB。
- 描画時は `canonicalParams` で `trajectory` を再計算して見せる（見た目と結果が必ず一致）。
- 生成: `pachisim atlas --board default` → `Resources/atlas/default.<boardhash16>.bin`。
- 実機初回起動時に先頭1024エントリを再計算して照合し、不一致なら全再生成（P2-T2）。

## 目標値（盤面チューニング）
- ヘソ入賞率 5〜8%（≒ 1000円=250発で 12〜20 回転）。`pachisim` で計測。
- 平均滞空 3〜5秒。
- 性能: `run` を M 系 Mac 単スレッドで 2,000発/秒以上。
