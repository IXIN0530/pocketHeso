# 30 Activity Claims（行動 → 報酬の台帳）
`packages/claims`。入力の検証と台帳の規則を持ち、`Grant`（spec/22）を生成する。DOM 非依存。
数値は `resources/economy/default.json` の `claims` 節。以下は初期値。

## 入力元と信頼度
| source | 入力 | trust | spec |
|---|---|---|---|
| `health` | ショートカットの受け取りコード（歩数・距離・上った階数） | 1.0 | 31 |
| `checkin` | トレーニングの開始/終了（YOLP 施設） | 1.0 | 32 |
| `checkin-own` | 同上（自分で登録した地点） | 0.8 | 32 |
| `self` | 自己申告（ToDo・習慣・チェックアウト忘れ） | 0.3 | — |

## 台帳（ClaimLedger, IndexedDB `claims` store, 追記のみ）
```ts
type ClaimRecord = { claimId: string; receivedAt: SimTime; source: Source; kind: Kind; day: string /*YYYY-MM-DD local*/
                     amount: number /*日の累計値 or 分*/; span?: [SimTime, SimTime]; trust: number; grant: Grant }
```
- **累計値の差分方式**: `steps`・`distance`・`flights` は日ごとの累計を受け取り、その日の既得最大値との差分だけを報酬にする。
  メダル・特別保留も「その日の累計から決まる枚数 − その日に既に出した枚数」で出す。
  何回同期しても二重取りにならない。値が減った場合（端末の補正）は何もしない。
- `claimId` = `${source}:${kind}:${day}:${連番}`（チェックインは `checkin:${sessionId}`）。
  同じ claimId は受け付けない。
- 受け取れる日: 今日と過去2日（ショートカットは3日分を返す）。それより古い日は無視。
- 日付はコード内の日付文字列（端末のローカル日付）を信用する。

## 変換（Grant = 即時の玉 prodMin ＋ 営業時間 fuelMs ＋ メダル ＋ 特別保留, D-081）
| kind | 即時の玉（生産◯分ぶん） | 燃料 | 逓減・上限（1日） | メダル | 特別保留 |
|---|---|---|---|---|---|
| steps | 1,000歩 → 30分 | 1,000歩 → 10分 | 〜10,000歩 等倍、〜15,000歩 半分、以降 0 | 2,000歩ごと +1（10,000歩まで = 5枚） | なし |
| checkin | 運動1分 → 10分 | 運動1分 → 2分 | 合算で 〜60分 等倍、〜120分 半分、以降 0 | 合算10分ごと +1（60分まで = 6枚） | 合算20分ごと 1つ（1日 3つまで） |
| self | 1件 → 10分 | 1件 → 10分 | 1日 5件まで | なし | なし |
| flights | なし | なし | 30階まで | 10階ごと +1（3枚, D-083） | なし |
- 即時の玉は Engine が受け取り時点の基準生産で玉にする（spec/23）。claims は「分」だけを決める。
- メダルの入手元は行動だけ（大当たりでは出ない, D-049）。累計獲得メダルが閉店時の常連P の上限になる（spec/23）。
  ほかに登録地点の初成立 +4（spec/32）。（遠征の到達 +10 は取り下げ, D-118）
- 最終的に `prodMin × trust`・`fuelMs × trust`。メダルと特別保留には trust を掛けない。
  自己申告（施設外・終了し忘れの checkin を含む, D-057）はメダル・特別保留・連続日数なし。
- 距離は表示用（歩数と二重に数えない。遠征は取り下げ, D-118。店は常連ツリーで開ける, spec/25）。
- ショートカットからワークアウトは受け取らない（D-022）。運動時間（checkin 行）はチェックインだけから数える。
- 既存の台帳の grant は書き換えない（D-081 より前の記録は旧換算のまま）。

## 連続日数（streak）
- その日の `health` か `checkin` で「歩数 ≥ 5,000 または 運動 ≥ 20分」を満たした日を達成日とする（self は数えない）。
- 途切れても **休養日パス**（週1回、自動適用）で1日は維持。休むのも健康のうち。
  パスは台帳に `rest` 記録（燃料0・streakDay 付き）として穴の翌日の達成時に入り、その日も1日と数える（週は月曜始まり, D-055）。
- `streakMult = 1 + 0.05 × min(連続日数, 20)`（spec/23）。Grant に `streakDay` を載せ、Engine が集計する。

## 不正の扱い（1人用）
改ざん防止ではなく「うっかり二重取り」と「自分へのごまかしの抑止」が目的。検証が弱い入力ほど trust を下げ、
上限と逓減で「やり過ぎても得しない」形にする。サーバー側の検証はしない（D-014）。

## API
```ts
export function parseShortcutCode(text: string, pairingKey: string, now: SimTime): ParsedHealth | ClaimError
export function planGrants(ledger: ClaimRecord[], input: ParsedHealth | CheckinResult | SelfReport, rules: ClaimRules): ClaimRecord[]
export function streakOf(ledger: ClaimRecord[], today: string, rules: ClaimRules): number
```
すべて純関数（時刻・鍵は引数）。UI は `planGrants` の結果を確認画面に出し、確定したら台帳と Engine に追記する。
