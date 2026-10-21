# P14 v1.5 店舗の開放（常連ツリー）・休業中の台選び・台のスペック表示（人間の要望 10/21）
目的: 遠征（移動距離の累計）で店を開ける案をやめ、**常連ツリーの段1（各 5 P）で国道店・港町店を開ける**。
開けた店の台は**休業中（閉店後〜開店前）に選べる**（新台入替）。あわせて設定から**各台のスペック**（大当たりの振り分けの円グラフ・ゲームフロー）を見られるようにする。
`dev` で開発し、人間が dev プレビューで確認してから `main` に出して `v1.5.0` にする（D-019）。P13 の T9・T10 が先でも後でもよい（独立）。

人間の要望（10/21）と対応:
| # | 要望 | 対応 |
|---|---|---|
| 1 | 店の開放が移動距離からで、そのタスク（P7-T12 遠征）を終えないと開かない | P7-T12 は取り下げ（D-118）。spec/30 の遠征の節を消す |
| 2 | 常連ツリーの段1で、それぞれ 5 P で新しい店を開ける（機種が 2 つ増える） | T1: ノード `shop_kokudo_open`（国道店・rush）・`shop_minato_open`（港町店・lt）、効果 `unlock_machine` |
| 3 | 店の切り替えは閉店後・開店前に選ぶ | T1: Action `pickMachine`（休業中だけ）→ 開店（手動・自動とも）で切り替え / T2: 休業のシートに「次に打つ台」 |
| 4 | 各台のスペックを設定から見られる（参考画像: 大当たり詳細の円グラフ・ゲームフロー） | T3: 設定 →「台のスペック」画面（3台、未開放の台も見られる） |

- 順番: T1 → T2 → T3 → T4 → T5。T3 は T1 に依存しない（T1 の前に回してもよい。同じ作業ツリーで同時に走らせない）。T5 は人間の指示がある時だけ。
- レビューは `/review P14-Tn` を書いた側と別のエージェントで。
- P7-T13（新台入替）は本フェーズの T1・T2 に置き換える（閉店時ではなく休業中に選ぶ。P7 は再開しても T13 を飛ばす）。
- 店と台の対応（変えない）: 駅前店 = `light-middle-01`（最初から）・国道店 = `rush-middle-01`・港町店 = `lt-middle-01`。

### P14-T1 Core: 台の開放（ツリー）と休業中の台選び
Owner: Claude Code（Opus） | Read: spec/22-core-engine（Action・新台入替・snapshot・Projection）, spec/25-core-prestige-tree（段1・効果・休業）, spec/23-core-economy（閉店・新台入替）
Do:
- ツリー（`resources/economy/default.json` の `tree`、段1の末尾に 2 つ。spec/25 の段1の表も 9 → 11 個・合計 44 → 54 P、全体 55 → 57 個・1,174 → 1,184 P）:
  | id | 名前 | 系統 | コスト | 前提 | 効果 |
  |---|---|---|---|---|---|
  | `shop_kokudo_open` | 国道店 開店 | 機種 | 5 | — | 国道店の台（rush-middle-01）を休業中に選べる（`unlock_machine` rush-middle-01） |
  | `shop_minato_open` | 港町店 開店 | 機種 | 5 | — | 港町店の台（lt-middle-01）を選べる（`unlock_machine` lt-middle-01） |
  - 効果 `unlock_machine { machine }` を `tree-config.ts` の parse・検証に足す（machine は機種一覧に無ければ警告。`prod_add_machine` と同じ扱い）。生産・閉店・EV には触れない。
  - 段の開放数（`tier_unlock`）には他のノードと同じく数える。段2の `shop_rush1`/`shop_lt1` の `req` に開放ノードを足すかは試算の影響を見て決める（推奨: 足さない＝試算不変）。
- 機種の切り替え（spec/22 の「新台入替」を書き換える。`close.machineId` は未実装なので**作らない**）:
  - `EngineConfig.machines?: readonly MachineSpec[]`（id で引く。反復順に依存しない）。選べる台 = 最初の機種（`cfg.spec`）＋ `unlock_machine` を買った台 ∩ machines。
  - 新 Action `{ t; k: 'pickMachine'; machineId }`: 休業中だけ。休業中でなければ rejected `'not-resting'`、選べない id は rejected `'machine'`。休業中に何度でも選び直せる（最後の1つ）。
    今の台と同じ id は「選んでいない」に戻す。保存は IdleEconomy か Engine の休業状態に `restMachineId`（snapshot に入れる）。
  - **開店（手動の `open`・30分の自動開店とも）**で `restMachineId` があればその台に切り替える。切り替え時は保留・変動中の結果・電サポ／大当たりの残りを捨て normal から（特別保留のストックは残す）。
    先に休業中の抽選の状態（大当たり中・電サポ中のまま閉店できるか、休業中に進むか）を確かめ、残りを捨てる以外の扱いが要るなら止まって人間に聞く。
  - 成功イベント `opened` に `machineId?`（切り替えた時だけ）。Projection に `machineId`（今の台）・`restMachineId`・`machinesOpen: string[]`（選べる台の id、machines の並び順）。
  - snapshot に今の機種 id と `restMachineId`。旧 snapshot は「最初の機種のまま・未選択」で読む（保存の版を上げるなら DECISIONS に）。
- pachisim: greedy は `unlock_machine` を見た目の `unlock` と同じ扱い（今の買い方の規則に合わせる）にし、`--tree greedy` の試算が変わらないことを確かめる。変わるなら差を STATUS Notes と DECISIONS に。
- spec/22・spec/23・spec/25 を直す（新台入替 = 休業中の pickMachine、ツリーの表と合計）。spec/30 の「遠征」の節と API の `expeditionOf`・メダルの入手元の「遠征の到達 +10」を消す（D-118。未実装なので claims のコードは無変更）。DECISIONS に D-番号で3行以内（`pickMachine`・開店で切り替え・捨てる物）。
- テスト（core）: 開放ノードなしで `pickMachine` rush → rejected 'machine'／買った後は通る／休業外は 'not-resting'／手動開店・自動開店の両方で切り替わり、
  その後の抽選が新しい台の表（当選確率・振り分け）になる／特別保留のストックは残る／選び直しで最後の1つ／同じ id で未選択に戻る／restore と1秒刻みの一致／
  `machines` を渡さない構成と pickMachine を使わない台本で golden 不変／ツリーの parse（`unlock_machine`・不明な機種は警告）。
Accept:
- [ ] `scripts/test.sh core` が通る（golden 不変）
- [ ] `scripts/sim.sh` の `--tree greedy` 試算が従来と同値（または差を記録）

### P14-T2 web: 3台を渡す・休業中の「次に打つ台」・表示を今の台に
Owner: Claude Code（Sonnet） | Read: spec/40-app-ui（休業・強化・記録）, spec/22-core-engine（pickMachine・Projection の machineId）
Do:
- `engine/game-config.ts` の `engineConfig` に `machines`（3台）を渡す。`meta.machineId` は「最初の機種」のまま（保存は変えない）。
  `stores/engine.ts` の `machineId` は Projection の今の台から取る（`machineRound`・`machineSakibareOdds`・盤面・液晶・HUD がそれを使う。D-077）。
- 店と台の表示名は web に1か所（例 `engine/machine-info.ts`: id → 店名・台名・一言。台名・一言は仮でよく、人間が後で直せる形に）。
- 休業のシート（ツリーのシートの休業表示, spec/40・spec/25 の休業画面）に「次に打つ台」の節: 3店を縦に並べる（店名・台名・大当たり確率と ST/LT 回転数の1行）。
  - 今の台に「いま」、選んだ台に「開店から」の札。選べない店は鍵の表示で「常連ツリー 段1・5P で開放」（タップでツリーのそのノードへスクロール）。
  - タップで `pickMachine`。今の台を選べば元に戻る。切り替えると保留と電サポの残りが消える旨を1行（RUSH 中に閉店していた時だけ強調）。
  - 「開店する」・自動開店のどちらでも選んだ台で開く（Core が行う）。開店の演出 `opened` の後、ホールに店名・台名を2秒ほど出す。
- ホールの上部（状態行の近く）に今の店名を小さく。記録の閉店履歴に、その周回の台（`opened.machineId` で区切る）。
- ツリーの行: `unlock_machine` は「休業中に選べる台が増える」の説明、買った後は「開放済み」。
- spec/40 の休業・強化（「閉店のシートで機種を選ぶ」を休業のシートに直す）・記録の節を直す。
- テスト（web）: 休業中だけ節が出る・未開放は押せない・選んで開店すると Projection の machineId が変わり液晶の round がその台のもの・自動開店でも同じ・リロード後も選んだ台が残る。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機は T4 でまとめて確認

### P14-T3 台のスペック画面（設定から）
Owner: Claude Code（Sonnet） | Read: spec/40-app-ui（設定・画面の表）, spec/21-core-lottery（機種 JSON・モード・振り分け・next）, spec/23-core-economy（大当たりボーナスの出玉）
Split: Opus — 機種 JSON から表示データを作る純関数の仕様（モードの流れ・継続率・出玉の式）とそのテスト / Sonnet — 画面・SVG・設定からの導線・web のテスト・spec
参考: 人間が添付した実機のスペック画像（大当たり詳細 = 入賞口ごとの円グラフ、ゲームフロー = 通常時 → 大当たり → RUSH の流れ図と基本性能の表）。
Do:
- 導線: 設定画面に「台のスペック」の行 → 全画面の画面（戻るで設定へ）。上部に3台のタブ（駅前店・国道店・港町店。未開放の台も見られ「未開放」の札。初期表示は今の台）。
- 表示データ（`machineSpecView(spec: MachineSpec)`。web の純関数、Core は変えない。web なので `Math.pow` 可）:
  - **大当たり詳細**（円グラフ）: 入賞口ごとに1枚。ヘソ = `normal`、電チュー = `jitan`・`st`・`lt`（機種にあるモードだけ。モードごとに1枚、見出しは「電チュー（RUSH 中）」「電チュー（時短中）」等）。
    扇 = `jackpot_split` のそのモードの重みが 0 でない枝。ラベルは「10R」「約1,500個」（rounds × round.count × payout_per_ball。`bonus_rounds` があれば「10R＋上乗せ 20R」）・次の状態の帯（RUSH / 時短 n回 / 通常）・割合 %（重みの比、整数に丸め、合計 100 になるよう最大剰余で）。
    出玉は「大当たりボーナス（生産連動）は別」と注記（spec/23 で今の出玉の仕組みを確かめ、表示の玉数が実際とずれるなら注記の書き方を合わせる）。
  - **ゲームフロー**: 通常時 → 大当たり（振り分け）→ RUSH（ST/LT の回転数）・時短 の箱と矢印。`next` の行き先で描く（lt の「通常 → 時短 100回 → RUSH」「ST → LT」も）。
    基本性能の表: 大当たり確率（通常時 1/185.0 など・RUSH 中 1/39.9）・ST/時短/LT の回転数・**RUSH 継続率** = 1 − (1 − 1/n)^回転数（その状態の振り分けで RUSH に戻る枝の割合を掛ける）・ヘソ賞球・保留数。
  - 色・言葉はアプリの既存トークン（ライト/ダーク両方）。円グラフ・矢印は手書きの SVG（ライブラリを足さない）。375px で崩れないこと。
- テスト: `machineSpecView` の3機種のスナップショット（割合の合計 100・扇の数・出玉・継続率の値を数値で）。画面は3タブが出る・未開放の札・ダークで読める（既存の画面テストの型に合わせる）。
- spec/40 の設定の表に「台のスペック」を1行。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機は T4 でまとめて確認

### P14-T4 実機確認
Owner: 人間（手順は Claude Code（Sonnet）） | 前提: P14-T1〜T3
Do: `dev` を push し、人間に手順を渡す（Debug で常連P・閉店を用意してよい。等倍は `/?debug=1&sandbox=1`）:
1. 常連ツリーの段1に「国道店 開店」「港町店 開店」（各 5 P）がある。買うと「開放済み」。
2. 閉店 → 休業のシートに「次に打つ台」が出る。未開放の店は押せず「段1・5P で開放」。開放した店を選んで「開店する」と、その台で打てる（液晶の R 数・大当たり確率が変わる）。
3. 選んで開店せず 30 分待っても（自動開店）選んだ台で開く。今の台を選び直すと元の台のまま。リロードしても選択が残る。
4. 設定 →「台のスペック」で3台の円グラフとゲームフローが見られる（未開放の台も「未開放」の札つき）。ダークモードで読める。
結果を STATUS Notes に。
Accept:
- [ ] 実機（人間）: 上の 1〜4 が OK

### P14-T5 v1.5.0 のリリース（main へ）
Owner: Claude Code（Sonnet） | Read: ref/tooling（デプロイ） | 前提: **人間の「リリースしてよい」の指示**。T1〜T4 が OK（P13-T10 が未リリースなら、人間の指示で v1.4.0 とまとめてよい）
Do: P8-T6 の手順 1〜4 と同じ。ルート `package.json` の version を 1.5.0 にしてからタグ `v1.5.0`。
本番確認は: Debug が無い・バージョン v1.5.0・既存セーブで開ける（最初の台は駅前店のまま）・ツリーで店を開けて休業中に台を選べる・台のスペックが見られる。
Accept:
- [ ] `main` と `dev` が同じコミットで、`v1.5.0` タグが付いている
- [ ] 本番の確認が人間から OK
