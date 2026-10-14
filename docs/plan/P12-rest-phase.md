# P12 v1.3 閉店後の休業（常連P を使ってから開店する）
目的: 閉店で得た常連P をその場で使い、keep・starter・開店ダッシュを**その周回から**効かせる（Cookie Clicker の天国 → 転生）。
人間の指摘（10/14）: 「閉店すると即開店しているので、買った物の効果を出すにはもう一度 100億 稼いで閉店しないといけない」。
仕様: spec/25 の「休業（閉店と開店の間, D-107）」と「画面」の休業画面。
`dev` で開発し、人間が dev プレビューで確認してから `main` に出して `v1.3.0` にする（D-019）。

- 順番: T1 → T2 → T3 → T4 → T5。T5 は人間の指示がある時だけ。
- 守ること: 閉店の条件・gain・常連P の量（不変条件1）は変えない。行動なしはランク 0・常連P 0 のまま。
- レビューは `/review P12-Tn` を書いた側と別のエージェントで。

### P12-T1 Core: 休業と開店（Action `open`・自動開店・保存 v8）
Owner: Claude Code（Opus） | Read: spec/25-core-prestige-tree（休業・購入のルール・保存）, spec/22-core-engine（Action・SimEvent・決定論契約・Projection）
Do:
- `economy-state.ts` の `onClose` を2つに分ける: `onClose`（条件・gain・常連P・`restAt = at`）と `onOpen`（今のリセット部分＋ `restPendingBalls`）。
- 休業中: perSec 0・燃料を減らさない・予告を抽選しない・番頭さんを動かさない。発射（手動）を rejected `'resting'`、オート打ちを止める。`close` も rejected `'resting'`。
- Grant の即時の玉を休業中は `restPendingBalls` へ。メダル・特別保留は今までどおり。
- Action `{ t; k: 'open' }`（休業中でなければ rejected `'not-resting'`）と自動開店（`restAt + close.rest_max_ms` の時刻ちょうど。advance・lookahead・留守中で同じ）。イベント `opened { at, auto }`。
- `default.json` の `close` に `rest_max_ms: 1800000`（検証: 60,000 以上の整数）。
- Projection に `rest`・`tree.nodes[].timing`（spec/25）。保存 IdleEconomy v8（`restAt`・`restPendingBalls`、v7 以前は null・0）。
- テスト:
  - `close` と `open` を同じ t で出す（間に何も買わない）と、今の `close` と玉・役物・強化の段・イベント（`opened` を除く）が一致する。
  - 休業中に starter・keep・open_dash を買ってから開店すると、その周回から効く。
  - 自動開店の境目（rest_max_ms − 1 では休業・ちょうどで開店）。留守中（長い advance）でも同じ時刻に開く。
  - 休業中の Grant の玉が開店後の持ち玉に入る。休業中は perSec 0・燃料が減らない・発射が rejected。
  - v7 のセーブを読むと休業でない状態で始まる。snapshot/restore の往復で休業が保たれる。
- 既存の `close` を使うテスト（economy-state・tree-engine 等）は同じ t の `open` を足して直す。golden が変わったら新ハッシュを DECISIONS に（保存項目が増えただけであることを確認して書く）。
- spec/22 に `open`・`opened`・`'resting'`/`'not-resting'` を足す（3行以内）。
Accept:
- [ ] `scripts/test.sh core` が通る（golden は不変か、変わった理由と新ハッシュが DECISIONS にある）
- [ ] Core に禁止 API・禁止演算・反復順依存が無い（`scripts/build.sh` の lint）

### P12-T2 pachisim: 閉店 → 買う → 開店 と試算のやり直し
Owner: Claude Code（Opus） | Read: spec/25-core-prestige-tree（休業・検証）
Split: Sonnet — econ.ts の手順変更と試算の実行・表づくり / Opus — 合否の判断と spec/25 の表・DECISIONS の更新
Do:
- `tools/pachisim/src/econ.ts`: 閉店したステップで「close → greedy で買える物を全部買う → 同じ t で open」にする（D-105 の「閉店したステップの購入を次のステップに回す」をやめる）。`--tree off` は close → open をすぐ続ける。
- spec/25 の検証 1・2・3・5・6・7 を測り直す。1・2・7 は今までと完全一致のはず（違えば T1 の誤り）。
  3・5・6 は starter・keep・開店ダッシュが1周早く効く分だけ動く。結果を `docs/state/econ-<日付>-p12.md` に。
- 5・6 が基準を外れたら spec/25 の「NG の時の調整順」に従わず**止めて**人間に判断を仰ぐ（STATUS の Blockers に数値つきで）。
Accept:
- [ ] `scripts/test.sh core`・`scripts/build.sh` が通る
- [ ] 検証 1・2・7 が一致。3・5・6 の結果と合否が econ の記録にある

### P12-T3 web: 休業画面と開店
Owner: Claude Code（Sonnet） | Read: spec/25-core-prestige-tree（画面・休業）, spec/40-app-ui（画面の表・操作感）
Do:
- `SNAPSHOT_VERSION` +1（前の版も読む）。
- 閉店の成功で常連ツリーのシートを自動で開き、上に「休業中　自動で開店まで mm:ss」、下に「開店する」ボタン（Action `open`）。
- シートを閉じても: ホールは「本日閉店」（盤面を暗く・発射ボタン無効・オート打ちの表示は「休業中」）。タブバーの上に「休業中　開店する ›」の帯（どのタブでも）。
- ツリーの行: `timing: 'open'` に「開店から」の小札（休業中でない時は「次の開店から」）。
- 休業中の行動の玉は帯に「開店時に +n玉」。開店で短い演出（演出パックに `opened`。既存素材）。自動開店した時は留守サマリーのバナーに「自動で開店しました」。
- 閉店カード・閉店のシートの文言を「閉店すると休業に入り、常連P を使ってから開店できます（30分で自動で開店）」に（30分は JSON から）。
- spec/40 の画面の表に「休業」行を足す（2行）。
- web のテスト: 閉店 → シートが開く → 買う → 開店、カウントダウンの表記、帯の表示条件、リロード（休業中のセーブ）で休業画面に戻る。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る

### P12-T4 実機確認
Owner: 人間（手順は Claude Code（Sonnet）） | 前提: P12-T1〜T3
Do: `dev` を push し、人間に手順を渡す（Debug で閉店できる状態にしてよい）:
1. 閉店 → ツリーのシートが自動で開き「休業中　自動で開店まで 29:xx」が出る。ホールは「本日閉店」で発射できない。
2. 休業中に「開店祝い」「開店ダッシュ」等を買って開店 → 役物が開店祝いの Lv から始まり、HUD に開店ダッシュの札が出る。
3. 閉店してアプリを閉じ、30分以上たってから開く → 自動で開店している（バナーに「自動で開店しました」）。
4. 休業中にシートを閉じて別のタブへ → 「開店する」の帯から開店できる。
結果を STATUS Notes に。
Accept:
- [ ] 実機（人間）: 上の 1〜4 が OK

### P12-T5 v1.3.0 のリリース（main へ）
Owner: Claude Code（Sonnet） | Read: ref/tooling（デプロイ） | 前提: **人間の「リリースしてよい」の指示**。T1〜T4 が OK
Do: P8-T6 の手順 1〜4 と同じ。ルート `package.json` の version を 1.3.0 にしてからタグ `v1.3.0`。
本番確認は: Debug が無い・バージョン v1.3.0・既存セーブが休業でない状態で開ける・閉店で休業に入り開店できる。
Accept:
- [ ] `main` と `dev` が同じコミットで、`v1.3.0` タグが付いている
- [ ] 本番の確認が人間から OK
