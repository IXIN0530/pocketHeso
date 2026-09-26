# 22 Core: Engine, Events, Projection
（旧 native-v1 spec/22 を移植。入力が「歩数」から「grants + ActionLog + presence」に変わった）

## 時刻
- `SimTime = number`（UNIX ms、整数。2^53 未満）。Core 内で `Date.now()` を呼ばない。UI が引数で渡す。
- 経済は **1000ms グリッド**（`economyTick`）、発射は **600ms グリッド** で進む。どちらも絶対時刻の倍数に揃える。

## 入力（すべて追記のみ、時刻昇順）
```ts
type Grant   = { claimId: string; at: SimTime; fuelMs: number; medals: number; streakDay?: string } // spec/30 が生成
type Action  =
  | { t: SimTime; k: 'buy'; target: UpgradeId; count: number }
  | { t: SimTime; k: 'awaken'; yakumono: YakumonoId }
  | { t: SimTime; k: 'shoot'; on: boolean; rate: number }          // 手動打ち（前面のみ）
  | { t: SimTime; k: 'auto'; share: number; rate: number }         // オート打ち設定 0..1
  | { t: SimTime; k: 'presence'; fg: boolean }                     // 前面/背面（放置効率・予告の出現）
  | { t: SimTime; k: 'noticeTap'; noticeId: number }
  | { t: SimTime; k: 'boost'; on: boolean }
  | { t: SimTime; k: 'close' }                                     // 閉店（周回）
```
- 検証に失敗した Action（残高不足・期限切れの予告等）は `rejected` イベントを出して無視する（状態は変えない）。
- 背面にいる間は `shoot` を自動で off 扱い（手動打ちは前面限定）。

## イベント
```ts
type SimEvent =
  | { k: 'fired'; ball: number; at: SimTime; rate: number }
  | { k: 'sensor'; ball: number; at: SimTime; kind: 'start1'|'out'|'lost' }
  | { k: 'holdAdded'; entry: HoldEntry; at: SimTime } | { k: 'holdOverflow'; ball: number; at: SimTime }
  | { k: 'spinStarted'; entry: number; at: SimTime; pattern: PatternId; endsAt: SimTime }
  | { k: 'spinResolved'; entry: number; at: SimTime; hit: boolean }
  | { k: 'jackpotStarted'; entry: number; at: SimTime; kind: JackpotKind; rounds: number }
  | { k: 'jackpotEnded'; entry: number; at: SimTime; payout: number }
  | { k: 'modeChanged'; to: Mode; at: SimTime; stRemaining: number }
  | { k: 'noticeSpawned' | 'noticeExpired'; id: number; at: SimTime; effect: NoticeEffect }
  | { k: 'granted'; claimId: string; at: SimTime; fuelMs: number; medals: number }
  | { k: 'fuelEmpty' | 'fuelRefilled'; at: SimTime }
  | { k: 'closed'; at: SimTime; regularPoints: number }
  | { k: 'rejected'; at: SimTime; action: Action['k']; reason: string }
type HoldEntry = { serial: number; hit: boolean; kind?: JackpotKind; pattern: PatternId; color: HoldColor; hot: number }
type Mode = 'normal' | 'jitan' | 'st' | 'lt'  // spec/21 モード拡張節。stRemaining は jitan/st/lt の残り回転数（normal は 0）
```
経済の毎秒の増減はイベントにしない（量が多い）。状態（`economy`）とスナップショットにだけ残す。

## Engine
```ts
export class Engine {
  constructor(cfg: EngineConfig /* seed, machine, board, atlas, economy */, grants: Grant[], actions: Action[])
  appendGrant(g: Grant): void; appendAction(a: Action): void   // 未来時刻のみ受け付ける（t ≥ now）
  advance(to: SimTime): SimEvent[]                              // 新規イベントのみ返す
  snapshot(): EngineSnapshot; static restore(s: EngineSnapshot, cfg: EngineConfig): Engine
  lookahead(until: SimTime): SimEvent[]   // 状態を変えずに未来を計算。「入力追加なし・背面」を仮定
  inFlight(): PendingSensor[]             // 飛行中の玉の写し（描画用。発射時刻・センサー時刻・入賞先）
}
```
- 玉の結果は `atlas[key(ball)]` を引くだけ（物理は走らせない）。センサー時刻 = 発射時刻 + flightMs。
- 同時刻の並び: Action/Grant → sensor → holdAdded/Overflow → spinResolved → jackpot* → spinStarted → mode → notice → economyTick。
- 性能: 放置24時間分の `advance`（オート打ち込み）が iPhone で 300ms 以内。超える場合は Web Worker で実行し進捗表示。

## 決定論契約（テスト必須）
1. 同じ入力で `advance(T)` を1回 vs 1秒刻み N 回 → 連結したイベント列と最終状態が完全一致。
2. `snapshot` → `restore` → 続行 の結果が通しと一致。
3. ゴールデン: seed=42、default 盤面、標準機種、固定の grants/actions 台本（`resources/golden/script01.json`）
   → イベント列＋最終経済状態の SHA-256 先頭16桁を固定。
4. 経済の計算は `+ - * /`・`Math.sqrt`・`Math.floor` のみ（spec/23）。

## Projection（純関数。UI はこれだけを見る）
```ts
export interface HallProjection {
  at: SimTime; mode: Mode; stRemaining: number
  holds: HoldColor[]; spin?: SpinView; jackpot?: JackpotView
  balls: number; medals: number; fuelMs: number; boostMs: number; perSec: number   // 現在の生産/秒（燃料・放置効率込み）
  yakumono: YakumonoView[]            // Lv, 次の価格, 回転位相と実効周期 periodS（描画用）, 覚醒数
  notice?: NoticeView                 // 表示中の予告
  totals: Totals                      // 回転数, 当たり, 出玉, 発射数, 累計玉
  nextHot?: HotHint                   // lookahead で見えている最も熱い予定
}
export function project(s: EngineState, at: SimTime): HallProjection
```
- **留守中サマリー**: 前面復帰時、`presence(fg=false)` 〜 now のイベントを集計した `AwaySummary`
  （獲得玉・大当たり回数・最大連チャン・燃料切れ時刻）を返す。UI は最も熱い当たりの演出を再生する（spec/40）。`replay` は留守中に変動を始めた当たりのうち hot 最大（D-068）。
