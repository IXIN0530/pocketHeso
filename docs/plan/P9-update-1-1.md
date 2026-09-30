# P9 Update 1.1（ラウンド5倍速・実績・レート表示）
目的: v1.0.0 の遊び心地を直す小さなアップデート。`dev` で開発し、人間が dev プレビューで確認してから `main` に出して `v1.1.0` にする（D-019）。
（9/30 人間: RUSH の出玉の貯まりが遅い／永続的な実績がほしい／4パチ解放以降レート欄の文字があふれる）

- 順番: T1 → T2 → T3 → T4 → T5 → T6。T1・T2 は独立で小さい（先に出して実機で確かめる）。T4 は T3 の後、T5 は T1・T3 の後。T6 は人間の指示がある時だけ。
- 同じ作業ツリーで2つのエージェントを同時に走らせない（どちらも `dev` にコミットする）。
- レビューは `/review P9-Tn` を書いた側と別のエージェントで。
- golden は T1・T3 で変わる。それぞれ新しいハッシュを DECISIONS に。

### P9-T1 大当たりのラウンドを5倍速に（1R 25秒 → 5秒, D-094）
Owner: Claude Code | Read: spec/21-core-lottery（機種 JSON・ラウンド）, spec/23-core-economy（バランス目標の打ち方 1〜3）
Do:
- `resources/machines/*.json` 3機種の `round.ms_per_round` を 25000 → 5000。`count`・`payout_per_ball` は変えない（出玉の量は同じ、時間だけ 1/5）。
- `apps/web/src/board/jackpot-hud.ts` の `DEFAULT_ROUND.msPerRound` を 5000。`OPEN_SHARE`（0.8 → 1R で玉10個が 4秒で入る）はそのまま。
  `HUD_START_MS`（2600）が1R目の半分に重なるが、1R目のカウントは裏で進めてよい（表示が遅れないこと）。jackpot-hud のテストが通ること。
- core のテストで 25000 を前提にした期待値があれば直す（テスト用の機種オブジェクトの値はそのままでよい）。golden の新ハッシュを DECISIONS に。
- `pachisim econ` を再実行し、P8-T9 の打ち方 1〜3 の結果を `docs/state/econ-<日付>.md` に追記（**機種値は変えない**。変化を STATUS Notes に1行）。
Accept:
- [x] `pnpm sim run` の期待値（出玉だけ）が T1 前と同じ（時間にしか効かないため）
- [x] `scripts/test.sh core`・`scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機（人間, dev push 後）: RUSH 中の 10R が約50秒で終わり、液晶の獲得出玉が 1R あたり約4秒で 10個ぶん増える。ラウンドの効果音が各Rで鳴る

### P9-T2 レート選択の表示を直す（4パチ解放以降のはみ出し, D-096）
Owner: Claude Code | Read: spec/40-app-ui（ホール・操作感）
Do:
- `apps/web/src/screens/hall-screen.tsx`: レートの `Segmented` の項目を数字だけ（`1` `2` `4` `10` `20` `40` `100`）にし、
  上に小さな見出し「レート（パチ）」を置く。1発のコストはこれまでどおり下の行「1発 ◯玉（生産8秒 × ◯パチ）」だけに出す（項目からは消す）。
- `hall.module.css`: レートの行は `.controls` の中で1行まるごと使う（`flex-basis: 100%`）。「打つ」ボタンと横に並べない。
- `components/segmented.module.css`: 項目が多い時に収まるよう、ボタンの `min-width` を 0・左右 padding を 4〜6px に下げる変種（例 `dense`）を足し、レートで使う。
  他の Segmented（設定など）の見た目は変えない。
- 「1発 ◯玉」の行は大きな数（`1.23兆玉`）でも折り返して崩れないこと（`.state` は flex-wrap 済み）。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機（人間, dev push 後）: Debug でメダルを入れてレートを 100パチまで全解放し、7項目が横にはみ出さず1行に収まる（iPhone 16e 縦持ち）。2項目・3項目の時も崩れない

### P9-T3 実績（Core: 判定・永続の生産倍率・保存, D-095）
Owner: Claude Code | Read: spec/24-core-achievements, spec/23-core-economy（生産倍率・基準生産・閉店）, spec/22-core-engine（イベント・同時刻の並び・決定論契約・Projection）
Do:
- `resources/economy/default.json` に `achievements`（`mult_per` 0.01 と spec/24 の一覧 44 個。id・metric・at・name）。`economy-config.ts` で読み込みと検証（spec/24「id の決まり」）。
- IdleEconomy: `awakenTotal`（覚醒ごとに +1、閉店で保持）、`achieved`（id・at の配列）、achMult を perSec と refPerSec に掛ける。スナップショット v6（v5 以前は spec/24「保存・移行」どおり）。
- Engine: economyTick の直後に判定し `achieved` イベントを出す（Engine 側の指標 firstHits・jackpots・maxChain・closes を渡す）。lookahead・留守中サマリー（達成数）・Projection の `achievements`。
- web: `SNAPSHOT_VERSION` を 5（v3・v4 も読める）。型の追加で壊れた箇所だけ直す（画面は T4）。
- spec/24 の判定規則をテストで固定: advance 1回と1秒刻みの一致／snapshot→restore 一致／旧 v5 から復元すると満たしている実績が最初の tick で達成／閉店しても達成と achMult が残る／
  achMult は達成の次の tick から効く／一覧から消えた id は数えない。golden の新ハッシュを DECISIONS に。
Accept:
- [x] 上のテストが通る。`scripts/test.sh core`・`scripts/build.sh`・`scripts/test.sh all` が通る
- [x] 旧セーブ（v1.0.0 で書き出したもの）を読み込んで落ちない（web のテストに v4 のスナップショットを1つ足す）

### P9-T4 実績の画面（記録タブ・トースト・留守中サマリー）
Owner: Claude Code | Read: spec/24-core-achievements（画面節）, spec/40-app-ui（記録・ホール・操作感）, spec/43-presentation-effects（CueSheet） | 前提: P9-T3
Do:
- `screens/records-screen.tsx`: 先頭に実績カード（「実績 n / 44・生産 +n%」、metric ごとに達成済み＝名前・達成日、次の1つ＝名前・現在値/しきい値の進捗バー、その先は「？？？」）。
  名前は economy JSON の `name` を使う（画面に直書きしない）。数値は `formatNum`。
- ホール: 前面で `achieved` を受けたら上部に短いトースト（2.5秒。同じ advance で複数なら1つにまとめる）。`prefers-reduced-motion` ではフェードだけ。
- 演出パック `resources/packs/default/pack.json` に `achieved`（既存素材の効果音1つ、触覚は軽く）。
- 留守中サマリー（`away-modal.tsx`）に「実績 +n」（0 なら出さない）。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る（まとめ方・進捗の計算は web のテストで）
- [ ] 実機（人間, dev push 後）: 既存のセーブで開くと実績がまとめて達成されトーストが1つ出る。記録タブで一覧と進捗が見え、横にはみ出さない。閉店後も実績と生産 +n% が残る

### P9-T5 実績込みの試算（バランス確認）
Owner: Claude Code | Read: spec/23-core-economy（バランス目標）, spec/24-core-achievements（一覧・効果） | 前提: P9-T1・P9-T3
Do:
- `pachisim econ` の出力に「日ごとの達成数と achMult」を足す（標準・行動なし・heavy）。
- spec/23 のバランス目標（初閉店が7日目前後・4週の伸び・行動なしで閉店できない・打ち方 1〜3）を実績込みで再確認し、結果を `docs/state/econ-<日付>.md` に。
- 初閉店が1日以上早まる／行動なしで閉店できるようになる場合は、**値を変えずに** STATUS に出して止まる（人間が mult_per か一覧を判断）。
Accept:
- [ ] 表が econ ファイルにあり、上の判定が OK か、NG を STATUS Blockers に書いて止まっている
- [x] `scripts/test.sh core`・`scripts/build.sh`・`scripts/test.sh all` が通る

### P9-T6 v1.1.0 のリリース（main へ）
Owner: Claude Code | Read: ref/tooling（デプロイ） | 前提: **人間の「リリースしてよい」の指示**。T1〜T5 の実機確認が OK
Do: P8-T6 の手順 1〜4 と同じ。ルート `package.json` の version を 1.1.0 にしてからタグ `v1.1.0`。
本番確認は: Debug が無い・バージョン v1.1.0・RUSH 10R が約50秒・レート7項目が収まる・既存のセーブで実績が付く。
Accept:
- [ ] `main` と `dev` が同じコミットで、`v1.1.0` タグが付いている
- [ ] 本番の確認が人間から OK
