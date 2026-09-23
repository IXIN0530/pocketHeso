# 21 Core: Machine Spec & Lottery

## 機種 JSON（`Resources/machines/<id>.json`）
```json
{
  "id": "light-middle-01", "version": 1,
  "modes": {
    "normal": {"jackpot_1_in": 199.8, "st_spins": 0},
    "st":     {"jackpot_1_in": 39.9,  "st_spins": 100}
  },
  "jackpot_split": [{"kind": "kakuhen", "weight": 50, "rounds": 10},
                    {"kind": "tsujo",   "weight": 50, "rounds": 4}],
  "round": {"count": 10, "payout_per_ball": 15, "ms_per_round": 25000},
  "hold_max": 4,
  "spin_patterns": "patterns.json",
  "hold_colors": [{"color": "blue", "w_hit": 10, "w_miss": 900},
                  {"color": "green","w_hit": 20, "w_miss": 70},
                  {"color": "red",  "w_hit": 50, "w_miss": 25},
                  {"color": "gold", "w_hit": 20, "w_miss": 0}]
}
```
- 確率は浮動小数で持たず、ロード時に `UInt32` 閾値へ変換（`threshold = UInt32.max / jackpot_1_in`）。
- `hold_colors` の `white`（通常）は重み残余として暗黙に存在。

## 流れ
1. **取得（ヘソ入賞時）**: 保留 < hold_max なら `HoldEntry` を作成。満タンなら `overflow`（無効）。
   取得時に当否・振分け・変動パターン・保留色を **全部確定** する（先読みの根拠）。
   - 当否は「消化時のモード」で判定するのが実機だが、MVP は **取得時のモード** で判定して簡略化（D-007 で記録すること）。
2. **消化**: 変動していなければ先頭保留を取り出し `spinStarted`。変動時間はパターンで決定。
3. **停止**: `spinResolved`。当たりなら `jackpotStarted` → ラウンド消化（時間経過のみで簡略） → `jackpotEnded(payout)`。
4. **モード**: kakuhen 当選後 → `st`（100回転）。ST 中の当たりは再度振分け。ST 消化で `normal`。

## 変動パターン（`patterns.json`）
```json
[{"id": "normal_short", "ms": 5000,  "hit_w": 0,  "miss_w": 600, "hot": 0},
 {"id": "reach_n",      "ms": 20000, "hit_w": 5,  "miss_w": 150, "hot": 1},
 {"id": "sp_reach",     "ms": 45000, "hit_w": 30, "miss_w": 40,  "hot": 3},
 {"id": "spsp_gekiatsu","ms": 70000, "hit_w": 55, "miss_w": 5,   "hot": 4},
 {"id": "kakutei",      "ms": 60000, "hit_w": 10, "miss_w": 0,   "hot": 5}]
```
- 保留数に応じた短縮（保留3〜4で normal_short を 2,000ms に）はパターン側の `ms_by_hold` で拡張可。
- `hot`（0〜5）は演出の熱さ。サーフェスの割り込み判定に使う（spec 42）。

## 乱数ストリーム
`RNGStreamID`: `.launch` `.launchJitter` `.jackpot` `.split` `.pattern` `.holdColor` `.presentation`
- 各抽選は `RNGStream(seed, id, index: entrySerial)` から取る。**演出側の乱数変更が当否に影響しない** ことを保証。

## 出玉と持ち玉（MVP）
- 発射は歩数クレジット消費で行い、持ち玉は減らさない（「打つほど減る」は後で設定化）。
- 大当たり出玉は `rounds × count × payout_per_ball` を加算し、統計として表示。
