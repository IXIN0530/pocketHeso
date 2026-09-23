# 22 Core: Engine, Events, Projection

## 型
```swift
public typealias SimTime = Int64          // UNIX ms
public struct Credits { var balls: Int64 } // 未発射クレジット

public enum SimEvent: Codable, Sendable, Equatable {
  case fired(ball: UInt64, at: SimTime)
  case sensor(ball: UInt64, at: SimTime, kind: SensorKind)       // start1 / out / lost
  case holdAdded(entry: HoldEntry, at: SimTime)
  case holdOverflow(ball: UInt64, at: SimTime)
  case spinStarted(entry: UInt64, at: SimTime, pattern: PatternID, endsAt: SimTime)
  case spinResolved(entry: UInt64, at: SimTime, result: SpinResult)
  case jackpotStarted(entry: UInt64, at: SimTime, kind: JackpotKind, rounds: Int)
  case jackpotEnded(entry: UInt64, at: SimTime, payout: Int64)
  case modeChanged(to: Mode, at: SimTime, stRemaining: Int)
}
public struct HoldEntry { serial: UInt64; isHit: Bool; kind: JackpotKind?; pattern: PatternID; color: HoldColor; hot: Int }
```

## 入力台帳
```swift
public struct InputLedger { public mutating func append(_ i: InputRecord) } // 時刻昇順・追記のみ
public struct InputRecord { from: SimTime; to: SimTime; steps: Int64; source: InputSource }
```
- 歩数 → クレジット（既定 1歩=1発, D-006）。発射は最大 100発/分 = 600ms 間隔で、
  クレジットが尽きるまで等間隔に発射時刻を割り当てる。

## Engine
```swift
public final class Engine {
  public init(seed: UInt64, machine: MachineSpec, board: Board, atlas: OutcomeAtlas, ledger: InputLedger)
  public func advance(to t: SimTime) -> [SimEvent]      // 新規イベントのみ返す
  public func snapshot() -> EngineSnapshot              // Codable
  public init(restoring: EngineSnapshot, ...)
  public func lookahead(until t: SimTime) -> [SimEvent] // 状態を変えずに未来を計算（既知の入力の範囲で）
}
```
- 玉の結果は `atlas[key(ball)]` を引くだけ（物理は走らせない）。センサー時刻 = 発射時刻 + flightMs。
- イベントの時刻順が同じ場合の並び: sensor → holdAdded/Overflow → spinResolved → spinStarted → mode。

## 決定論契約（テスト必須）
1. 同じ入力で `advance(to: T)` を1回 vs 1秒刻み1000回 → 連結したイベント列が完全一致。
2. `snapshot` → 復元 → 続行 の結果が、通しで回した結果と一致。
3. ゴールデン: seed=42, default 盤面, 標準機種, 10万歩 → イベント列 SHA256 先頭16桁を固定。

## Projection（純関数。拡張・UI はこれだけを見る）
```swift
public struct SurfaceProjection: Codable, Sendable {  // ≤ 1KB（Live Activity の ContentState に流用）
  var at: SimTime; var mode: Mode; var stRemaining: Int
  var holds: [HoldColor]            // 最大4
  var spin: SpinView?               // pattern, endsAt, hot
  var jackpot: JackpotView?         // round, totalRounds
  var totals: Totals                // spins, hits, payout, ballsFired
  var nextHot: HotHint?             // 先読みで分かっている最も熱い予定（時刻と hot）
}
public func project(_ s: EngineState, at: SimTime) -> SurfaceProjection
public func projectTimeline(_ e: Engine, from: SimTime, every ms: Int64, count: Int) -> [SurfaceProjection]
```
- `projectTimeline` は `lookahead` を使う。ウィジェットの60エントリはこれで作る。
  注: 未来の歩数は未知。**タイムラインは「現時点のクレジット残で打ち切る」前提で作る**（歩けば次の更新で上書き）。
