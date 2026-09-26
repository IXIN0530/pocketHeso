# 21 Core: Machine Spec & Lottery
（旧 native-v1 spec/21 を移植。変更点: 打つと持ち玉が減る、レート制、D-016/D-017）

## 機種 JSON（`resources/machines/<id>.json`）
```json
{
  "id": "light-middle-01", "version": 1, "tier": "middle",
  "modes": {
    "normal": {"jackpot_1_in": 199.8, "st_spins": 0},
    "st":     {"jackpot_1_in": 39.9,  "st_spins": 100}
  },
  "jackpot_split": [{"kind": "kakuhen", "weight": 50, "rounds": 10},
                    {"kind": "tsujo",   "weight": 50, "rounds": 4}],
  "round": {"count": 10, "payout_per_ball": 15, "ms_per_round": 25000},
  "heso_payout": 3,
  "hold_max": 4,
  "spin_patterns": "patterns.json",
  "hold_colors": [{"color": "blue", "w_hit": 10, "w_miss": 900},
                  {"color": "green","w_hit": 20, "w_miss": 70},
                  {"color": "red",  "w_hit": 50, "w_miss": 25},
                  {"color": "gold", "w_hit": 20, "w_miss": 0}]
}
```
- 確率はロード時に `uint32` 閾値へ変換（`threshold = floor(2^32 / jackpot_1_in)`、`>>> 0` で扱う）。
- `hold_colors` の `white` は重み残余として暗黙に存在。
- 振分けの各枝は `weight`（通常時）と任意の `weight_st`（ST 中。省略時は `weight`）を持つ。0 可・各モードの合計は正。
  同じ `kind` でも `rounds` が違えば並べてよい（例: 初当たり 3R 確変 / RUSH 中 10R 確変, D-036）。
- `tier`（甘デジ `sweet` / `middle` / `max`）は新台入替（spec/23, 後期）で選ぶ。

## 打つ（ShootOrder）
- 発射は**持ち玉を消費**する。1発 = `rate` 玉（レート制。1パチ=1, 4パチ=4, … 解放制, spec/23）。
  賞球・出玉もすべて `× rate`。経済がインフレしても抽選の価値が相対的に保たれる。
- 発射速度は最大 100発/分（600ms 間隔）。手動（前面で「打つ」）とオート打ち（生産の x% を自動投入）の2種。
- オート打ちの発射時刻は Engine が 600ms グリッドに割り当てる（spec/22）。

## 流れ
1. **取得（ヘソ入賞時）**: 賞球 `heso_payout × rate`。保留 < hold_max なら `HoldEntry` 作成、満タンなら `overflow`。
   取得時に当否・振分け・変動パターン・保留色を**全部確定**（先読み・予約通知の根拠）。
   当否は取得時のモードで判定（D-017）。
2. **消化**: 変動していなければ先頭保留を取り出し `spinStarted`。変動時間はパターンで決定。
3. **停止**: `spinResolved`。当たりなら `jackpotStarted` → ラウンドは時間経過で消化 → `jackpotEnded(payout)`。
4. **モード**: kakuhen 当選後 → `st`（100回転）。ST 中の当たりは再度振分け。ST 消化で `normal`。
- 保留4＋変動時間が**時間あたりの抽選回数の上限**になる（玉をいくら入れても抽選は頭打ち）。これが経済の安全弁。

## 変動パターン（`resources/machines/patterns.json`）
```json
[{"id": "normal_short", "ms": 5000,  "hit_w": 0,  "miss_w": 600, "hot": 0},
 {"id": "reach_n",      "ms": 20000, "hit_w": 5,  "miss_w": 150, "hot": 1},
 {"id": "sp_reach",     "ms": 45000, "hit_w": 30, "miss_w": 40,  "hot": 3, "climax_ms": 38000},
 {"id": "spsp_gekiatsu","ms": 70000, "hit_w": 55, "miss_w": 5,   "hot": 4, "climax_ms": 62000},
 {"id": "kakutei",      "ms": 60000, "hit_w": 10, "miss_w": 0,   "hot": 5, "climax_ms": 50000}]
```
- 保留3〜4で `normal_short` を 2,000ms に短縮（`ms_by_hold` で拡張可）。変動短縮は経済の強化でも倍率がかかる。
- `hot`（0〜5）= 演出の熱さ。`hot = max(パターン hot, 保留色ボーナス[red+1, gold→5])`。

## 乱数（D-016）
- 生成器: `xoshiro128**`（32bit、`Math.imul` と `>>> 0` のみ）。ストリーム初期化: `splitmix32(hash(seed, streamId, index))`。
- `RNGStreamID`: `launch` `launchJitter` `jackpot` `split` `pattern` `holdColor` `presentation` `notice` `economy`
- 各抽選は `RNGStream(seed, id, entrySerial)` から取る。**演出側の乱数変更が当否に影響しない**。
- `nextU32()`、`nextUnit()`（[0,1)、`u32 / 2^32`）、`pick(weights)`（整数重み）。

## 出玉
- 大当たり出玉 = `rounds × count × payout_per_ball × rate`。大当たりでメダルは出ない（D-049）。大当たり中の生産フィーバーは spec/23。
- 期待値の目安（初期・レート1）: 1玉あたりの払い戻し ≈ 0.85。強化で 1 付近まで（spec/23 の上限）。

## モード拡張: 時短・LT・上乗せ（D-037。実装は P2-T7〜T9）
リゼロ2のような一撃型に寄せる拡張。**取得時に全部確定（D-017）は変えない**。上乗せ量も取得時に決まり、演出は後から段階的に見せるだけ。

### モード
| モード | 役割 | 確率 | 回数 |
|---|---|---|---|
| `normal` | 通常時 | `modes.normal` | 無制限 |
| `jitan` | 時短（通常当たり後の引き戻しチャンス） | `modes.jitan`（通常と同じ確率が基本） | `spins` 回 |
| `st` | RUSH | `modes.st` | `spins` 回 |
| `lt` | 上位 RUSH（ラッキートリガー） | `modes.lt` | `spins` 回 |
- 各モードの JSON は `{"jackpot_1_in": N, "spins": M}`（旧 `st_spins` も読む）。`jitan`・`lt` は省略可（省略した機種では出ない）。
- 大当たり終了時に、その枝の `next` のモードへ移り、残り回数を `spins` にする。残り回数は変動1回ごとに −1、0 で `normal` へ。
- 時短・RUSH・LT 中の変動は保留数によらず短縮パターンを使う（ST と同じ扱い）。

### 振分けの枝
`{"kind", "rounds", "bonus_rounds"?, "next"?, "weight", "weight_jitan"?, "weight_st"?, "weight_lt"?}`
- `next`: 終了後のモード。省略時は `kakuhen`→`st`、`tsujo`→`normal`（今の機種と同じ動き）。
- 重みの省略時: `weight_jitan` = `weight`、`weight_st` = `weight`、`weight_lt` = `weight_st`。
- `bonus_rounds`: **上乗せ**（省略時は 0）。出玉 = `(rounds + bonus_rounds) × count × payout_per_ball × rate`。大当たり時間も合計ラウンド分。
- 同じ `(kind, rounds, bonus_rounds, next)` の枝は重複不可。合計ラウンドは 60 以内。

### 上乗せイベント・投影
- `jackpotStarted` に `bonusRounds` を足す（演出が上乗せの大きさを先に知るため。見せるのは後）。
- `uwanose { entry, at, addRounds, totalRounds }` を基本ラウンドの消化が終わる時刻（開始 + `rounds × ms_per_round`）に出す。
- 投影に `chain`（RUSH 入りからの連チャン数）と `chainBalls`（その累計出玉）を足す。LT 中の「累計◯◯発」表示に使う。
- 上乗せの見せ方（段階表示・音・光）は spec/43 で扱う。

### 例: `lt-middle-01`（理論値。P2-T9 で pachisim の実測と照合）
- 通常 1/349.9。初当たりは 3R（450玉）で、25% は RUSH へ直行、75% は時短 100 回（引き戻し約25%。時短中の当たりはすべて RUSH 行き）。実質の RUSH 突入率は約44%。
- RUSH: 1/39.9 × 56回（継続率約76%）。当たりは 10R（1500玉）で、そのうち 4% が LT 昇格。RUSH に入ったうち約11%が LT に届く。
- LT: 1/39.9 × 91回（継続率約90%）。当たりは 10R に上乗せ +0/+10/+20/+40R を 60/25/10/5 で振り分け、平均 約2,475玉。
- 通常1回転あたりの期待出玉は約9.88玉で、light-middle-01（9.74玉）と揃えている。初当たり1回で5万玉以上になるのは約0.75%、10万玉以上は約0.09%。
