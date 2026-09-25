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
  "medal": {"per_jackpot": 1, "per_kakuhen": 2},
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
3. **停止**: `spinResolved`。当たりなら `jackpotStarted` → ラウンドは時間経過で消化 → `jackpotEnded(payout, medals)`。
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
- 大当たり出玉 = `rounds × count × payout_per_ball × rate`。メダル = `per_jackpot`（確変なら `per_kakuhen`）。
- 期待値の目安（初期・レート1）: 1玉あたりの払い戻し ≈ 0.85。強化で 1 付近まで（spec/23 の上限）。
