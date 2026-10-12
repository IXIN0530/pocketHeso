# P10 常連ツリー（常連P の使い道, D-100〜D-103）
目的: 閉店で貯まる常連P を使って永続の能力（52 ノード・5 段）を開け、数週間〜数か月単位で遊べるようにする（Cookie Clicker の天国のアップグレード相当, spec/25）。
`dev` で開発し、人間が dev プレビューで確認してから `main` に出して `v1.2.0` にする（D-019）。
（10/12 人間: 常連P を使う仕組みを。能力の種類を多く、数か月貯めないと届かない能力も。標準で全部そろうまで 6〜12 か月）

- 順番: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9。T5（試算）は T4 の後。T6（画面）は T4 の後で T5 と順不同（同じ作業ツリーで同時に走らせない）。T9 は人間の指示がある時だけ。
- 着手前に spec/25 末尾の「未決事項」を人間に1行で確認する（返事が無ければ推奨のまま進めてよい）。
- 同じ作業ツリーで2つのエージェントを同時に走らせない（どちらも `dev` にコミットする）。
- レビューは `/review P10-Tn` を書いた側と別のエージェントで。
- golden は T2〜T4 で変わり得る。変わったら新しいハッシュを DECISIONS に。

### P10-T1 設定 JSON と型（ツリーの一覧・読み込み・検証。効果はまだ無し）
Owner: Claude Code | Read: spec/25-core-prestige-tree（段と前提・ノード一覧・効果の種類・設定 JSON）
Do:
- `resources/economy/default.json` に `tree`（points_per_rank・run_bonus_at・tier_unlock・bantou・nodes 52 個。name・desc は spec/25 の表の文言）。
- `packages/core/src/economy-config.ts`（大きくなるなら `tree-config.ts` に分ける）: 読み込みと検証（spec/25「設定 JSON」の全エラー条件・合計の上限）。
  型 `TreeSpec`・`TreeNodeSpec`・`TreeEffect`（k ごとの判別共用体）を `index.ts` から export。`tree` が無い JSON は空のツリー。
- テスト: 既定 JSON が通る／各エラー条件が1つずつ弾かれる／合計の上限を超えると弾かれる／`tree` 無しで空。
- AGENTS.md のドキュメント索引に `docs/spec/25-core-prestige-tree.md`（常連ツリー）を1行足す。
Accept:
- [ ] 上のテストが通る。`scripts/test.sh core` が通る（golden は不変）

### P10-T2 IdleEconomy: 常連P（通貨）・購入・保存 v7
Owner: Claude Code | Read: spec/25（常連ランクと常連P・購入のルール・保存）, spec/23-core-economy（閉店） | 前提: P10-T1
Do:
- `economy-state.ts`（ツリーの部分は `tree-state.ts` に分けてよい）: `points`・`pointsEarned`・`tree`（id・cost・at）。閉店で spec/25 の式で常連P を足す（gain 0 なら 0）。
  `buyTreeNode(id, at)`（段・前提・P・二重購入の検査、reason は spec/25 の5種）・`getTreeView()`。効果の集計（添字順の真偽配列→キャッシュ）の枠だけ作る（効果の適用は T3/T4）。
- スナップショット v7（spec/25「保存・移行」。v6 以前は points = 10 × regular）。一覧から消えた id は数えず cost を返す。
- テスト: 常連P の量（gain・runBonus の段の境目・gain 0 で 0）／**ランク（regular）と closeGain がツリーで変わらない**／購入の拒否5種／段が開く境目／
  v6 から復元／snapshot→restore 一致／消えた id の返金。
Accept:
- [ ] 上のテストが通る。`scripts/test.sh core` が通る

### P10-T3 効果（経済の中で閉じるもの）
Owner: Claude Code | Read: spec/25（効果の種類と計算・生産の式・不変条件）, spec/23-core-economy（生産倍率・基準生産・強化・閉店） | 前提: P10-T2
Do:
- IdleEconomy に効果を入れる: prod_add（＋機種 id を受け取る prod_add_machine）・regular_add・ach_per_add・streak_max_add・price_sub・keep・starter・open_boost（tick で減る・refPerSec に入れない）・
  closed_add・tank_add_h・boost_cap_add_h・boost_mult_add・awaken_medal_base・prod_min_add・points_add。
- 予告の設定（`getNoticeConfig()`）にツリー込みの値: notice_interval_sub・fever_ms_add・fever_mult_add・rush_cap_add_s・notice_bonus_weight_add。
- テスト（効果ごとに1つ以上）: 次の tick から効く／keep の対象だけ閉店で残る／starter・openBoost は閉店で入り時間で切れる／openBoost は refPerSec に入らない／
  価格の値下げがまとめ買いにも効く／合計の上限どおりの全取得の倍率（spec/25 の天井 treeMult 2.3 等）／禁止演算を使っていない（lint・grep）。
Accept:
- [ ] 上のテストが通る。`scripts/test.sh core` が通る

### P10-T4 Engine: Action・予告の自動受け取り・特別保留・番頭さん・Projection・web の保存版
Owner: Claude Code | Read: spec/25（効果の種類のうち notice_auto・grant_hold_1_in・bantou、番頭さん、Engine・Action・Projection）, spec/22-core-engine（入力・同時刻の並び・決定論契約・Projection） | 前提: P10-T3
Do:
- `engine.ts`: Action `treeBuy`・`bantou`（失敗は rejected）。closed イベントに `points?`。予告の間隔・フィーバーは `getNoticeConfig()` から。機種 id を経済へ。
  notice_auto（前面で出た予告を出現 +3秒で受け取る）・grant_hold_1_in（行動の特別保留だけ）・番頭さん（60秒の格子で自動購入, spec/25）。
- Projection に `tree`（spec/25 の形）。ShopView の閉店見込みに `nextClosePoints`。lookahead・留守中は番頭さん込みで同じ規則。
- 決定論テスト: treeBuy・bantou を含む台本で advance 1回と1秒刻みが一致／snapshot→restore 一致／番頭さんの購入順（最安・同額は添字）／24時間 advance の時間が番頭さん off の 1.5倍以内。
- web: `SNAPSHOT_VERSION` 6（3・4・5 も読む）。型の追加で壊れた箇所だけ直す（画面は T6）。v5 のスナップショットを読むテストを1つ足す。
- golden が変われば新ハッシュを DECISIONS に。spec/22 に Action・イベント・Projection の追加を数行で反映。
Accept:
- [ ] `scripts/test.sh core`・`scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 旧セーブ（v1.1.0 で書き出したもの）を読み込んで落ちず、常連P が「10 × ランク」で出る（web のテスト）

### P10-T5 試算とバランス調整（pachisim econ）
Owner: Claude Code | Read: spec/25（獲得の目安・何週目に何が買えるか・倍率の重なり・検証） | 前提: P10-T4
Do:
- `tools/pachisim/src/econ.ts`: `--tree off|greedy|all`・`--start-rank <n>`・`--bantou on|off`・日別の列 `tree(P/earned/owned/xmult)`・閉店ごとの常連P の内訳。
  `--start-rank` は Engine の snapshot を作って restore（Core に試算専用 API を足さない）。econ.test.ts に off＝ツリー空 JSON と一致のテスト。
- spec/25「検証」の 1〜9 を 3機種で実行し（84日は1本 数分、182日は十数分。バックグラウンドで回す）、表と判定を `docs/state/econ-<日付>-p10.md` に。
  runBonus の実測で spec/25 の「獲得の目安」と「何週目に何が買えるか」の表を更新する。
- NG は spec/25 の調整順で値（JSON のコスト・効果量）だけ直して再実行。1・2・7 の NG は実装の誤りとして T2〜T4 を直す。値を変えたら spec/25 の表と DECISIONS を更新。
- 3回調整しても 3〜6 が収まらない時は STATUS Blockers に書いて止まる（人間が判断）。
Accept:
- [ ] econ ファイルに 1〜9 の表があり全て OK、または NG を STATUS Blockers に書いて止まっている
- [ ] `scripts/test.sh core`・`scripts/build.sh`・`scripts/test.sh all` が通る

### P10-T6 常連ツリーの画面（強化タブ・シート・閉店の内訳・HUD）
Owner: Claude Code | Read: spec/25（画面）, spec/40-app-ui（強化・操作感） | 前提: P10-T4
Do:
- `screens/shop-screen.tsx`: 閉店ボタンの上に「常連ツリー　常連P m（ランク n）」の行と番頭さんの ON/OFF → 新しい `screens/tree-sheet.tsx`（下から出るシート）。
  段のタブ（閉じた段は「あと k 個で開く」）・系統ごとの縦リスト・行タップで詳細と `hold-button`「長押しで開ける」。
- 名前・説明は economy JSON の `tree.nodes` から（`engine/achievement-defs.ts` と同じ流儀で、parseEconomy をメインのチャンクに入れない）。
- 閉店のシート: 常連P の内訳（ランク・累計玉の段・口コミ）と閉店後の「常連ツリーへ」。ホール HUD: 開店ダッシュの残り。
- 呼び名（常連ランク／常連P）を既存の画面の文言でもそろえる（強化・記録・閉店）。
- web のテスト: 状態の表示（owned/buyable/short/locked・段の開き）・P とランクの表示・名前の引き当て。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機（人間, dev push 後）: Debug で常連P を入れ、iPhone 16e 縦で段のタブと一覧が横にはみ出さず、長押しで開けられ、ランクは減らず常連P は減る

### P10-T7 見た目の解放と演出
Owner: Claude Code | Read: spec/25（演出・効果の unlock）, spec/43-presentation-effects（CueSheet）, spec/50-app-rendering（筐体・玉・液晶の材質） | 前提: P10-T6
Do:
- unlock 5種（金のランプ・液晶「夜桜」・クロームの筐体・金の玉・殿堂入り）を既存の描画のパラメータ差し替えで作る（新しい素材ファイルなし）。設定で選ぶ（端末の表示設定、セーブ外）。
- 演出パック `resources/packs/default/pack.json` に `treeBought`・`tierOpened`（既存素材の効果音・触覚は軽く）。`prefers-reduced-motion` では光らせない。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機（人間, dev push 後）: 5種の見た目が切り替わり、盤面の性能（既存の確認項目）が落ちない

### P10-T8 実機確認（閉店の流れ・既存セーブ）
Owner: 人間（手順は Claude Code） | Read: spec/25（購入のルール・画面） | 前提: P10-T5・P10-T7
Do: `dev` を push し、人間に手順を渡す: 既存セーブで開く → 常連P が 10 × ランク で出る → 段1を数個開ける → 閉店 → 常連P の内訳・開店祝いの Lv・開店ダッシュの札・保持した強化の段・生産 +n% が合う → 番頭さんを Debug で入れて ON にし留守中に役物が増える。結果を STATUS Notes に。
Accept:
- [ ] 実機（人間）: 上の手順が OK

### P10-T9 v1.2.0 のリリース（main へ）
Owner: Claude Code | Read: ref/tooling（デプロイ） | 前提: **人間の「リリースしてよい」の指示**。T1〜T8 が OK
Do: P8-T6 の手順 1〜4 と同じ。ルート `package.json` の version を 1.2.0 にしてからタグ `v1.2.0`。
本番確認は: Debug が無い・バージョン v1.2.0・既存のセーブで常連P が出る・ツリーで開けて閉店後も残る。
Accept:
- [ ] `main` と `dev` が同じコミットで、`v1.2.0` タグが付いている
- [ ] 本番の確認が人間から OK
