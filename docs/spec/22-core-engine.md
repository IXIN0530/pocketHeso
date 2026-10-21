# 22 Core: Engine, Events, Projection
（旧 native-v1 spec/22 を移植。入力が「歩数」から「grants + ActionLog + presence」に変わった）

## 時刻
- `SimTime = number`（UNIX ms、整数。2^53 未満）。Core 内で `Date.now()` を呼ばない。UI が引数で渡す。
- 経済は **1000ms グリッド**（`economyTick`）、発射は **600ms グリッド** で進む。どちらも絶対時刻の倍数に揃える。

## 入力（すべて追記のみ、時刻昇順）
```ts
type Grant   = { claimId: string; at: SimTime; fuelMs: number; medals: number; streakDay?: string   // spec/30 が生成
                 prodMin?: number     // 即時の玉 = refPerSec × prodMin × 60（spec/23, D-081。省略は0）
                 bonusHolds?: number } // 特別保留の数（整数。省略は0）
type Action  =
  | { t: SimTime; k: 'buy'; target: UpgradeId; count: number }
  | { t: SimTime; k: 'awaken'; yakumono: YakumonoId }
  | { t: SimTime; k: 'shoot'; on: boolean; rate: number }          // 手動打ち（前面のみ）
  | { t: SimTime; k: 'auto'; share: number; rate: number }         // オート打ち設定 0..1
  | { t: SimTime; k: 'presence'; fg: boolean }                     // 前面/背面（放置効率・予告の出現）
  | { t: SimTime; k: 'treeBuy'; node: string }                     // 常連ツリーの購入（rejected: unknown-node/owned/tier-locked/locked/insufficient-points, spec/25）
  | { t: SimTime; k: 'bantou'; on: boolean }                      // 番頭さんの ON/OFF（未所持は rejected 'not-owned'）
  | { t: SimTime; k: 'noticeTap'; noticeId: number }
  | { t: SimTime; k: 'boost'; on: boolean }
  | { t: SimTime; k: 'close' }                                    // 閉店（周回）。休業に入る（D-107）
  | { t: SimTime; k: 'open' }                                     // 開店（休業を終えてリセット。休業中でなければ rejected 'not-resting', D-107）
  | { t: SimTime; k: 'pickMachine'; machineId: string }           // 次の開店で打つ台（休業中だけ。rejected 'not-resting'・'machine', D-119）
```
- 検証に失敗した Action（残高不足・期限切れの予告等）は `rejected` イベントを出して無視する（状態は変えない）。
- 背面にいる間は `shoot` を自動で off 扱い（手動打ちは前面限定）。
- 休業中（close〜open, spec/25）は `close` と `shoot`（on）を rejected `'resting'`。発射・生産・予告は止まり、自動開店は同時刻の入力より先に処理する。

## イベント
```ts
type SimEvent =
  | { k: 'fired'; ball: number; at: SimTime; rate: number; unit?: number } // unit は発射時の単価（省略時は rate, D-090）
  | { k: 'sensor'; ball: number; at: SimTime; kind: 'start1'|'out'|'lost' }
  | { k: 'holdAdded'; entry: HoldEntry; at: SimTime } | { k: 'holdOverflow'; ball: number; at: SimTime }
  | { k: 'spinStarted'; entry: number; at: SimTime; pattern: PatternId; endsAt: SimTime }
  | { k: 'spinResolved'; entry: number; at: SimTime; hit: boolean }
  | { k: 'jackpotStarted'; entry: number; at: SimTime; kind: JackpotKind; rounds: number; bonusRounds?: number; upper?: true; loops?: number }
      // rounds は基本ラウンド。bonusRounds は上乗せの合計（上位は bonus_rounds + add_rounds × K）。upper・loops は上位の時だけ（D-120）
  | { k: 'uwanose'; entry: number; at: SimTime; addRounds: number; totalRounds: number }  // LT の上乗せの告知（上位では出ない）
  | { k: 'jackpotEnded'; entry: number; at: SimTime; payout: number }  // payout=出玉（取得時の unit 込み, D-090）
  | { k: 'modeChanged'; to: Mode; at: SimTime; stRemaining: number }
  | { k: 'noticeSpawned' | 'noticeExpired'; id: number; at: SimTime; effect: NoticeEffect }
  | { k: 'granted'; claimId: string; at: SimTime; fuelMs: number; medals: number; balls?: number; bonusHolds?: number } // balls=即時の玉
  | { k: 'fuelEmpty' | 'fuelRefilled'; at: SimTime }
  | { k: 'closed'; at: SimTime; regularPoints: number; points?: number }
  | { k: 'opened'; at: SimTime; auto: boolean; machineId?: string }   // 開店（auto は restAt + rest_max_ms の自動開店, D-107。machineId は台を切り替えた時だけ）
  | { k: 'rejected'; at: SimTime; action: Action['k']; reason: string }
  | { k: 'achieved'; id: string; at: SimTime }   // 実績の達成（spec/24, D-095）
type HoldEntry = { serial: number; hit: boolean; kind?: JackpotKind; pattern: PatternId; color: HoldColor; hot: number; unit?: number; upper?: true; loops?: number } // unit は取得時の単価（無い旧セーブは rate, D-090）。upper・loops は上位の当たりだけ（snapshot にも入る, D-120）
type Mode = 'normal' | 'jitan' | 'st' | 'lt'  // spec/21 モード拡張節。stRemaining は jitan/st/lt の残り回転数（normal は 0）
```
経済の毎秒の増減はイベントにしない（量が多い）。状態（`economy`）とスナップショットにだけ残す。

## Engine
```ts
export class Engine {
  constructor(cfg: EngineConfig /* seed, machine, machines?, board, atlas, economy */, grants: Grant[], actions: Action[])
  appendGrant(g: Grant): void; appendAction(a: Action): void   // 未来時刻のみ受け付ける（t ≥ now）
  advance(to: SimTime): SimEvent[]                              // 新規イベントのみ返す
  snapshot(): EngineSnapshot; static restore(s: EngineSnapshot, cfg: EngineConfig): Engine
  lookahead(until: SimTime): SimEvent[]   // 状態を変えずに未来を計算。「入力追加なし・背面」を仮定
  inFlight(): PendingSensor[]             // 飛行中の玉の写し（描画用。発射時刻・センサー時刻・入賞先）
}
```
- 玉の結果は `atlas[key(ball)]` を引くだけ（物理は走らせない）。センサー時刻 = 発射時刻 + flightMs。
- 同時刻の並び: Action/Grant → sensor → holdAdded/Overflow → spinResolved → jackpot* → 特別保留の投入 → 電サポの自動補充 → spinStarted → mode → notice → economyTick → 番頭さん → achieved（実績の判定, spec/24）。
- 常連ツリー（詳細は spec/25）: closed.points は今回得た常連P（0 は省略）。notice_auto は前面で出た予告を出現+ms に手のタップと同じ経路で受け取る（背面なら受け取らず、期限内に前面へ戻ればその時刻）。grant_hold_1_in は行動の特別保留だけが 1/value で当たり。番頭さんは 60,000ms の倍数の economyTick の直後に自動購入（イベントなし）。treeBuy 成功後に予告設定を読み直す。
- **特別保留**（D-081）: Grant.bonusHolds はストック（snapshot `bonusStock`）に足し、保留に空きがあれば1つずつ入れる（`holdAdded`）。
  抽選は `RNGStream(seed, 'grantHold', n)`（n はストックから出した通し番号, 0 始まり）、serial = `GRANT_HOLD_SERIAL_BASE`（1.5e9）+ n。
  当否・色は予告のボーナス保留（`drawBonusHold`）と同じ規則、rate1・賞球なし。取得時のモードで表を選ぶ。
- **新台入替**（D-119。旧 close.machineId は未実装のまま廃止）: `EngineConfig.machines`（MachineSpec の配列。id で引く。反復順に依存しない）。
  選べる台 = 最初の台（`cfg.spec`）＋ ツリーの `unlock_machine` を買った台 ∩ machines（spec/25）。
  休業中に `pickMachine` で次の台を選ぶ（何度でも選び直せて最後の1つ。今の台の id は未選択に戻す）。休業中でなければ rejected 'not-resting'、選べない id は 'machine'。
  **開店**（手の `open`・自動開店とも）で選んだ台に切り替える。保留・変動中の結果・電サポ／大当たりの残りを捨て normal から（RUSH 中なら `modeChanged` normal を `opened` の直後に出す）。
  特別保留のストック・飛行中の玉は残す（玉は新しい台の表で引く）。閉店で選択は消える。
  snapshot に `machineId`（最初の台なら省略）・`restMachineId`（未選択なら省略）。旧 snapshot は最初の台・未選択。知らない id の snapshot は restore でエラー。
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
  holds: HoldColor[]; spin?: SpinView; jackpot?: JackpotView   // JackpotView.rounds は見せてよい合計。上位は upper・loops を足す
  rushUpper: boolean   // 上位の当たりが終わってから、次の jackpotStarted か ST を抜けるまで true（snapshot の spin.rushUpper、false は省略, D-120）
  balls: number; medals: number; fuelMs: number; boostMs: number; perSec: number   // 現在の生産/秒（燃料・放置効率込み）
  refPerSec: number; bonusStock: number; machineId: string   // 基準生産（spec/23）・特別保留のストック・今の機種
  restMachineId: string | null; machinesOpen: string[]        // 休業中に選んだ次の台・選べる台（machines の並び順, D-119）
  yakumono: YakumonoView[]            // Lv, 次の価格, 回転位相と実効周期 periodS（描画用）, 覚醒数
  notice?: NoticeView                 // 表示中の予告
  totals: Totals                      // 回転数, 当たり, 出玉, 発射数, 累計玉
  nextHot?: HotHint                   // lookahead で見えている最も熱い予定
  achievements: AchievementsView      // 達成（id・時刻）・今の achMult・進捗用の指標の値（spec/24）
  tree?: TreeView                     // 常連ツリー（常連P・購入済み・nextClosePoints 等, spec/25）
}
export function project(s: EngineState, at: SimTime): HallProjection
```
- **留守中サマリー**: 前面復帰時、`presence(fg=false)` 〜 now のイベントを集計した `AwaySummary`
  （獲得玉・大当たり回数・最大連チャン・燃料切れ時刻・達成した実績の数）を返す。UI は最も熱い当たりの演出を再生する（spec/40）。`replay` は留守中に変動を始めた当たりのうち hot 最大（D-068）。
