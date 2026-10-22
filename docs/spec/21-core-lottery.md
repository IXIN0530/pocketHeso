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
  "round": {"count": 10, "payout_per_ball": 15, "ms_per_round": 5000},
  "heso_payout": 3,
  "hold_max": 4,
  "spin_patterns": "patterns.json",
  "hold_colors":    [{"color": "white", "w_hit": 5,  "w_miss": 99317},
                     {"color": "blue",  "w_hit": 10, "w_miss": 381},
                     {"color": "green", "w_hit": 15, "w_miss": 172},
                     {"color": "red",   "w_hit": 40, "w_miss": 115},
                     {"color": "gold",  "w_hit": 30, "w_miss": 15}],
  "hold_colors_st": [ ...同じ形。ST・LT 中の表... ]
}
```
- `ms_per_round` は1ラウンドの時間（初期 5000 = 1R 5秒・10R 50秒。旧 25000 から全ての大当たりで5倍速, D-094）。出玉は大当たり終了時にまとめて入るので、量は変わらず時間だけ短くなる。
- 確率はロード時に `uint32` 閾値へ変換（`threshold = floor(2^32 / jackpot_1_in)`、`>>> 0` で扱う）。
- 保留色の表は白を含む5色すべてを書く（当否それぞれの合計は正, D-072）。取得時のモードで表を選ぶ: 通常・時短は `hold_colors`、ST・LT は `hold_colors_st`（省略時は `hold_colors`）。
  目安（1/349.9・1/39.9）: 通常時は信頼度 青7%・緑20%・赤50%・金85%、出現 青1/245・緑1/467・赤1/437・金1/993（色付き約1/105）。
  ST 中は当たりの40%が白から、信頼度 青15%・緑35%・赤70%・金95%、出現 青1/40・緑1/93・赤1/186・金1/253（色付き約1/22）。
  通常の当たりが重い/軽い機種は、色付きのハズレ重みを当たり率に合わせて増減し、同じ信頼度に揃える（D-099 で当たり率を上げた時もこの方法で直した）。`pnpm sim holds` で実測と理論値を比べる（許容 信頼度±2pt・出現率±8%）。
- 保留変化（表示を始める色・途中の段階・変わる時点）は演出側が決める（spec/43）。Core は最終色だけを決める。
- 振分けの各枝は `weight`（通常時）と任意の `weight_st`（ST 中。省略時は `weight`）を持つ。0 可・各モードの合計は正。
  同じ `kind` でも `rounds` が違えば並べてよい（例: 初当たり 3R 確変 / RUSH 中 10R 確変, D-036）。
- `tier`（甘デジ `sweet` / `middle` / `max`）は新台入替（spec/23, 後期）で選ぶ。

## 打つ（ShootOrder, D-090）
- 発射は**持ち玉を消費**する。1発 = `unit` 玉（単価 `unit = floor(rate × refPerSec × shot_s)`、最低 `rate`。`refPerSec` は発射時点の基準生産、`shot_s` = 8）。
  レート制（1/2/4/10/20/40/100、解放制, spec/23）。賞球・出玉も取得時の `unit` で払う（後から生産が変わっても変わらない, D-017 と同じ考え）。
- 発射速度は最大 100発/分（600ms 間隔）。手動（前面で「打つ」）とオート打ち（投入額 = 生産 × share を `unit` で割った発数）の2種。
- オート打ちの発射時刻は Engine が 600ms グリッドに割り当てる（spec/22）。燃料 0 で止まるのは従来どおり。
- 無料の保留（予告のボーナス保留・行動の特別保留・電サポ中の自動補充）は取得時の 1パチの単価。

## 流れ
1. **取得（ヘソ入賞時）**: 賞球 `heso_payout × unit`。保留 < hold_max なら `HoldEntry`（`unit` を持つ）作成、満タンなら `overflow`。
   取得時に当否・振分け・変動パターン・保留色を**全部確定**（先読み・予約通知の根拠）。
   当否は取得時のモードで判定（D-017）。
2. **消化**: 変動していなければ先頭保留を取り出し `spinStarted`。変動時間はパターンで決定。
3. **停止**: `spinResolved`。当たりなら `jackpotStarted` → ラウンドは時間経過で消化 → `jackpotEnded(payout)`。
4. **モード**: kakuhen 当選後 → `st`（100回転）。ST 中の当たりは再度振分け。ST 消化で `normal`。
- 保留4＋変動時間が**時間あたりの抽選回数の上限**になる（玉をいくら入れても抽選は頭打ち）。これが経済の安全弁。

## 変動パターン（`resources/machines/patterns.json`）
```json
[{"id": "normal_short", "ms": 5000,  "hit_w": 0,  "miss_w": 1395, "hot": 0},
 {"id": "reach_n",      "ms": 20000, "hit_w": 5,  "miss_w": 150, "hot": 1},
 {"id": "sp_reach",     "ms": 45000, "hit_w": 30, "miss_w": 40,  "hot": 3, "climax_ms": 38000},
 {"id": "spsp_gekiatsu","ms": 35000, "hit_w": 55, "miss_w": 5,   "hot": 4, "climax_ms": 31000},
 {"id": "kakutei",      "ms": 60000, "hit_w": 10, "miss_w": 0,   "hot": 5, "climax_ms": 50000}]
```
- 保留3〜4で `normal_short` を 2,000ms に短縮（`ms_by_hold` で拡張可）。変動短縮は経済の強化でも倍率がかかる。
- 保留の最終色が白以外の変動は、短縮（保留数・変動短縮）の後に `max(時間, spin_min_colored_ms)`（機種 JSON。0〜120000、省略は 0。3機種 6600 = 割れる演出 5400＋図柄 1200, D-112）。
- `hot`（0〜5）= 演出の熱さ。`hot = min(5, パターン hot + 保留色ボーナス[red+1, gold+2])`（金は確定ではないので最大にしない, D-072）。

## 乱数（D-016）
- 生成器: `xoshiro128**`（32bit、`Math.imul` と `>>> 0` のみ）。ストリーム初期化: `splitmix32(hash(seed, streamId, index))`。
- `RNGStreamID`: `launch` `launchJitter` `jackpot` `split` `pattern` `holdColor` `presentation` `holdChange` `notice` `grantHold` `economy` `uwanose`（`holdChange` は保留変化の見せ方, spec/43。`uwanose` は上位の上乗せ回数 K, D-120）
- 各抽選は `RNGStream(seed, id, entrySerial)` から取る。**演出側の乱数変更が当否に影響しない**。
- `nextU32()`、`nextUnit()`（[0,1)、`u32 / 2^32`）、`pick(weights)`（整数重み）。

## 出玉（D-090）
- 大当たり出玉 = `rounds × count × payout_per_ball × unit`（取得時の `unit`）。大当たりでメダルは出ない（D-049）。
  大当たりボーナス（D-080）は廃止。液晶の獲得出玉は出玉（× unit）のまま。
- 期待値（出玉だけ・レートによらない, D-099）: `sim econ --ev-hours 1000` の実測（60 seed 平均）で初期 約1.10（light 1.10・rush 1.13・lt 1.10, P15-T2）、全強化で約1.2。`sim run` の payout/ball の理論値は light 0.98・rush 0.99・lt 0.90（実測との差はボーナス保留など無料の抽選分）。

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
- 同じ `(kind, rounds, bonus_rounds, next, upper の有無)` の枝は重複不可。合計ラウンドは 60 以内。
- `upper`（任意, D-120）: 上位の枝。`{"add_rounds": 10, "loop_1_in": 4, "loop_max": 4}`。`next` が `st` の枝だけ。
  取得時に上乗せの回数 K を引く: `RNGStream(seed, 'uwanose', serial)` から最大 `loop_max` 回 `nextU32()`、`floor(2^32 / loop_1_in)` 未満なら K+1 して続け、以上なら止める（外れ・upper でない枝では引かない）。
  合計ラウンド = `rounds + bonus_rounds + add_rounds × K`（出玉・大当たり時間とも）。検証: `add_rounds` ≥ 1・`loop_1_in` > 1・`loop_max` ≥ 1・`rounds + bonus_rounds + add_rounds × loop_max` ≤ 60。
  保留（`HoldEntry`）に `upper: true`・`loops: K`。上位の当たりは `uwanose` イベントを出さない（見せる時刻は演出側, spec/43）。

### 上乗せイベント・投影
- `jackpotStarted` に `bonusRounds` を足す（演出が上乗せの大きさを先に知るため。見せるのは後）。
- `uwanose { entry, at, addRounds, totalRounds }` を基本ラウンドの消化が終わる時刻（開始 + `rounds × ms_per_round`）に出す。
- 投影に `chain`（RUSH 入りからの連チャン数）と `chainBalls`（その累計出玉）を足す。LT 中の「累計◯◯発」表示に使う。
- 上乗せの見せ方（段階表示・音・光）は spec/43 で扱う。

### 例: `rush-middle-01`（上位RUSH, D-120。理論値と P15-T2 の実測。`docs/state/econ-20261022-p15.md`）
- 通常 1/328.0。初当たりは 3R（450玉）で 35% が RUSH、65% は通常。
- RUSH: 1/39.9 × 66回（継続率 81.3%、実測 81.0%）。当たりは 10R（1,500玉）75% / 上位 20R（3,000玉）＋上乗せ 25%（実測 24.7%）。
- 上乗せ: 1回 +10R（+1,500玉）、1/4 で次へ・最大4回（P(K ≥ k) = 0.25^k、E[K] = 85/256 ≈ 0.332、実測 K0〜K4 = 74.5/19.1/4.7/1.4/0.4%）。上位の当たりの平均 約3,498玉・最大 60R（9,000玉、実測で到達）。
- RUSH 中の当たり1回の平均 約2,000玉（1,999.5）。RUSH に入ってからの当たりの平均回数 4.34。通常1回転あたりの期待出玉 10.63玉（`sim run` 理論値。2億球の実測 10.31 は初当たりの引きのぶれ）。初当たり1回で5万玉以上は約0.19%。
- 旧セーブで ST の残りが 66 を超えていてもそのまま数え下ろす。

### 例: `lt-middle-01`（理論値。P2-T9 で pachisim の実測と照合）
- 通常 1/337.0（時短中も同じ, D-099）。初当たりは 3R（450玉）で、25% は RUSH へ直行、75% は時短 100 回（引き戻し約26%。時短中の当たりはすべて RUSH 行き）。実質の RUSH 突入率は約44%。
- RUSH: 1/39.9 × 56回（継続率約76%）。当たりは 10R（1500玉）で、そのうち 4% が LT 昇格。RUSH に入ったうち約11%が LT に届く。
- LT: 1/39.9 × 91回（継続率約90%）。当たりは 10R に上乗せ +0/+10/+20/+40R を 60/25/10/5 で振り分け、平均 約2,475玉。
- 通常1回転あたりの期待出玉は約10.39玉で、light-middle-01（10.52玉）・rush-middle-01（10.63玉）と揃えている。初当たり1回で5万玉以上になるのは約0.75%、10万玉以上は約0.09%。
