# 24 Core: 実績（永続の生産倍率, D-095）
参考: Cookie Clicker の実績とミルク。達成した実績の数だけ生産が永続的に少し伸びる。閉店してもリセットしない。
数値・一覧は `resources/economy/default.json` の `achievements` に置き、コードに直書きしない。

## 効果
```
achMult = 1 + achievements.mult_per × 達成数        # 初期 mult_per = 0.01（1個 +1%。加算）
perSec    = Σ役物 × (1 + 常連P) × streakMult × achMult × boost × 予告フィーバー × 状態係数
refPerSec = max(Σ役物 × (1 + 常連P) × streakMult × achMult, prod_ref.min_per_sec)
```
- refPerSec にも掛かる（行動の即時報酬・玉の単価の単位が一緒に伸びる。spec/23 の「どちらも基準生産で量る」を保つ）。
- 一覧から消えた id（下の「id の決まり」）は達成数に数えない。

## 指標（metric）
すべて Core が決定論で持っている値。閉店で減らない値か、減っても「一度届いたら達成のまま」で扱う。
| metric | 値 | 出どころ | 閉店で |
|---|---|---|---|
| `ballsTotal` | 全期間累計玉（`totalTotal`。役物・賞球・出玉・即時報酬・予告の合計） | IdleEconomy | 保持 |
| `medalsEarned` | 累計獲得メダル（D-049） | IdleEconomy | 保持 |
| `refPerSec` | 基準生産/秒（achMult 込み） | IdleEconomy | 下がる（達成は残る） |
| `yakumono` | 今の周回で Lv ≥ 1 の役物の種類数（0〜8） | IdleEconomy | 0 に戻る（達成は残る） |
| `awakenTotal` | 覚醒の累計回数（**新設**。覚醒を実行するたび +1） | IdleEconomy | 保持 |
| `rateStage` | レート解放の段（0＝1パチのみ … 6＝100パチまで） | IdleEconomy | 保持 |
| `streakDays` | 連続日数（spec/30） | IdleEconomy | 保持（途切れると下がる。達成は残る） |
| `firstHits` | 初当たり回数（Totals） | Engine | 保持 |
| `jackpots` | 大当たり回数（Totals） | Engine | 保持 |
| `maxChain` | 最大連チャン（Totals） | Engine | 保持 |
| `closes` | 閉店回数（CloseRecord の数） | Engine | 保持 |

## 一覧（初期値。合計 44 個 → 全達成で生産 ×1.44）
`{ "id", "metric", "at", "name" }`。`at` 以上で達成。`name` は画面の表示名（Core は計算に使わない）。
| metric | at（しきい値） | 個数 |
|---|---|---|
| ballsTotal | 1万 / 100万 / 1億 / 100億 / 1兆 / 100兆 / 1京 | 7 |
| refPerSec | 10 / 1,000 / 10万 / 1,000万 / 10億 / 1,000億 | 6 |
| medalsEarned | 10 / 40 / 100 / 200 / 400 / 1,000 | 6 |
| yakumono | 3 / 5 / 8 | 3 |
| awakenTotal | 1 / 5 / 10 / 25 | 4 |
| rateStage | 2（4パチ）/ 4（20パチ）/ 6（100パチ） | 3 |
| firstHits | 1 / 10 / 50 / 100 | 4 |
| maxChain | 3 / 5 / 10 / 20 | 4 |
| closes | 1 / 3 / 10 | 3 |
| streakDays | 3 / 7 / 14 / 30 | 4 |
- 標準の行動の1週目でおよそ 12〜16 個（生産 +12〜16%）を想定。初閉店の時期（spec/23 のバランス目標）が大きく前にずれないことを `pachisim econ` で確かめる。
- 名前は日本語で短く（例: 「はじめての出玉」「千発ホルダー」「常連の風格」）。一覧の順番は上の表の順（metric ごと、しきい値の昇順）。

## id の決まり
- `<metric>_<しきい値の短縮>`（例 `ballsTotal_1e8`・`maxChain_10`）。一度出した id は意味を変えない・使い回さない。
  しきい値を変える時は新しい id にし、古い id は一覧から消す（達成済みでも数えなくなる。DECISIONS に記録）。
- 読み込み時の検証: id 重複・未知の metric・`at` ≤ 0・`mult_per` が 0〜0.1 の外 → エラー。

## 判定（決定論）
- **economyTick（1秒ごと）の最後**に、一覧を JSON の順（配列の添字順）に見て、未達成で `値 ≥ at` のものを達成にする。
  同じ tick で複数達成したら配列の順に全部。達成時刻は その tick の時刻。achMult は **次の tick から**効く（同じ tick の生産は変えない）。
- 購入・Grant・閉店などで値が変わっても、判定は次の economyTick。これで `advance(T)` 1回と1秒刻みが一致する（spec/22 決定論契約 1）。
- 反復は配列の添字順だけ（Map/Set・オブジェクトのキー順に依存しない）。数値比較は `>=` のみ。
- イベント: `{ k: 'achieved'; id: string; at: SimTime }`。同時刻の並びは economyTick の直後（spec/22）。
- lookahead でも同じ規則で出る（状態は変えない）。留守中サマリーは留守中の achieved の数を数える。

## 保存・移行
- 達成は IdleEconomy が持つ（生産倍率に効くため）: スナップショット v6 に `achieved: { id: string; at: number }[]`（達成順）と `awakenTotal: number`。
- 旧 v5 以前: `achieved` は空、`awakenTotal` は今の周回の覚醒数の合計（Σawakened。過去の周回の分は分からないので下限）。
  復元後の最初の tick で、その時点で満たしているものがまとめて達成になる（過去の最大連チャン・閉店回数などは Totals に残っているので拾える）。
- 未知の id（一覧から消えたもの）は snapshot には残すが、達成数に数えない（将来戻しても二重にならない）。

## Projection（spec/22 に追加）
```ts
achievements: {
  done: { id: string; at: SimTime }[]            // 達成順
  mult: number                                   // 今の achMult
  metrics: Record<AchievementMetric, number>     // 進捗表示用の今の値（キー順に依存した処理はしない）
}
```

## 画面（spec/40）
- 記録タブの先頭に「実績 n / 44・生産 +n%」と一覧。metric ごとに達成済み（名前・達成日）と次の1つ（名前・現在値 / しきい値の進捗バー）。未達成の先は伏せる（「？？？」）。
- 達成した時、前面ならホール上部に短いトースト「実績「◯◯」 生産 +1%」（同時に複数なら「実績を n 個達成 生産 +n%」）。演出パックの `achieved`（効果音のみ、既存素材）。
- 留守中サマリーに「実績 +n」。
