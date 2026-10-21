# P13 v1.4 抽選カスタム・先バレ・演出の手直し・役物の強化（人間のフィードバック 10/20）
目的: v1.3.0 を使って出た不満を直す。先バレを「選べて・分かる」ものにし、結果の先出しと RUSH の変化保留の早さを直し、
メダルと常連P で役物が**目に見えて**強くなるようにする（Cookie Clicker の作りを参考に）。
`dev` で開発し、人間が dev プレビューで確認してから `main` に出して `v1.4.0` にする（D-019）。

人間の指摘（10/20）と対応:
| # | 指摘 | 対応 |
|---|---|---|
| 1 | 抽選のカスタムが欲しい（リゼロ・東京喰種の先バレカスタム）。**最優先** | T1: 「通常」＋先バレ 3 種（信頼度/占有率 40%/95%・90%/90%・100%/60%） |
| 2 | 先バレが、通常時はヘソ入賞時・RUSH 時は最後尾に保留が追加された時になっているか | T2: テストで確認し、ずれていれば直す |
| 3 | 先バレが分かりにくい。`apps/web/public/sounds/先バレ音.mp3` にする | T3: 合成音をこのファイルに差し替え |
| 4 | 当たる直前に「打つ」ボタンの上に「大当たり中 4R」が出る（通常の大当たり・RUSH の継続） | T4: ホールの状態行を盤面の表示時刻に合わせる |
| 5 | RUSH の変化保留が一瞬で割れて一瞬で抽選が終わる | T5: 色の付いた保留の変動に最短時間を設け、割れる演出を通常時と同じ尺で見せる |
| 7 | カスタムの先バレが鳴っても保留が変化せず、熱い演出が来ない（10/21 実機）。リゼロ等は先バレ → 変化保留が確定 | T8b: カスタムの先バレは必ず変化保留（灰色の点滅 → 割れて色が出る）にする。信頼度 r・保留色の信頼度は変えない |
| 6 | メダルの役物強化（覚醒）がしょぼい。常連P でも役物が実質強くならない | T6〜T8: 覚醒を作り直し（Lv を戻さない・共鳴）、ツリーに役物を強くするノードを足す |

- 順番: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T8b → T9 → T10。T1〜T5 は互いに独立（同じ作業ツリーで同時に走らせない）。
  T7 は人間の OK で止まる。T10 は人間の指示がある時だけ。
- レビューは `/review P13-Tn` を書いた側と別のエージェントで。
- 用語: **信頼度** = 先バレした時に当たる割合 P(当たり | 先バレ)。**占有率** = 当たりのうち先バレする割合 P(先バレ | 当たり)。

### P13-T1 抽選カスタム（先バレの信頼度・占有率を選ぶ）
Owner: Claude Code（Opus） | Read: spec/43-presentation-effects（保留変化・先バレ）, spec/40-app-ui（設定・画面の表）, spec/21-core-lottery（保留色・確率）
Split: Opus — fx の先バレ抽選（式・乱数・統計テスト）/ Sonnet — prefs・設定画面・lcd-timeline への接続・web のテスト
Do:
- 選択肢（`prefs.sakibareCustom`、既定 `'normal'`、localStorage の prefs に保存。不正値は既定に戻す）:
  | 値 | 画面の名前 | 信頼度 r | 占有率 o |
  |---|---|---|---|
  | `normal` | 通常 | 今のまま（色で決める, D-074。約40% / 約24%） | |
  | `sb40` | 先バレ 信頼度40%・占有率 高（95%） | 0.40 | 0.95 |
  | `sb90` | 先バレ 信頼度90%・占有率 高（90%） | 0.90 | 0.90 |
  | `sb100` | 先バレ 信頼度100%・占有率 中（60%） | 1.00 | 0.60 |
- fx（`hold-change.ts` に足す。Core は触らない）: `planSakibare(seed, serial, hit, p, custom): boolean`
  - `normal` は `planHoldChange(...).sakibare` をそのまま返す（今と完全一致）。
  - それ以外: 当たりなら確率 `o`、ハズレなら確率 `q = p·o·(1−r) / (r·(1−p))`（r=1 なら 0）で先バレ。
    `p` は取得時のモードの当選確率（`modeOf(spec, mode).thresholdU32 / 2^32`）。乱数は `RNGStream(seed, 'sakibare', serial)` を1回だけ
    （`'holdChange'` の流れは使わない＝保留の色・変化の見せ方はカスタムで変わらない）。確率は整数の重み（10^6 刻み）に丸めて `pick`。
  - カスタム時は**先バレと保留変化を切り離す**: 変化（灰色の点滅 → 割れる）は `planHoldChange(...).change` のまま、
    先バレは音と光だけ（先バレしても点滅を強制しない。白い保留に先バレが付く＝ガセもある）。
  - 対象は発射玉の保留と電サポの自動保留。特別保留・ボーナス保留（通し番号 1e9 以上 2e9 未満）はカスタム時は先バレしない。
- web: `LcdHold` に取得時の `mode` と取得時のカスタムを持たせ（`holdAdded` を反映する時点の `rush.mode` と prefs）、
  `sakibareTimes` が `planSakibare` を使う。設定を変えたら**次に取得した保留から**効く（取得済みの保留は取得時の設定）。
  `hit` が分からない保留（Projection から作った・リプレイ）は今どおり先バレしない。
- 設定画面に「抽選カスタム」の節: 4 行のラジオ（1行に名前、下に小さく「先バレした時に当たる割合 r%・当たりのうち先バレする割合 o%」）。
  375px で折り返しても崩れないこと。ホールの状態行に、通常以外の時だけ小さく「カスタム 先バレ90%」を出す。
- spec/43 の先バレの節に「抽選カスタム」を 3 行で足す。DECISIONS に1行（式・乱数の流れ・特別保留を除く）。
- テスト:
  - fx: 3機種 × normal/st の表で、seed を変えた大量試行（各 20 万保留程度）の実測が `r`・`o` に ±0.02 以内。`sb100` はハズレで一度も先バレしない。
    `normal` は既存の `planHoldChange` の結果と全 seed で一致。同じ引数なら同じ結果。
  - web: カスタムを変えても保留の見せる色（`shownLcdState`）が変わらない・取得後に設定を変えても既に取った保留の先バレは変わらない・特別保留は先バレしない。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る（Core は無変更）
- [ ] 実機は T9 でまとめて確認

### P13-T2 先バレの時刻の確認（通常: ヘソ入賞 / RUSH: 最後尾に保留が追加された時）
Owner: Claude Code（Sonnet） | Read: spec/43-presentation-effects（先バレ）, spec/22-core-engine（SimEvent の holdAdded・電サポの自動保留）
Do:
- 今の実装: 先バレは `holdAdded` の時刻 + `SAKIBARE_DELAY_MS`(150) に鳴る（`lcd-timeline.ts` の `sakibareTimes`、`board-scene.ts` の `noteSakibare`）。
  通常時の保留は玉がヘソ（`start1`）に入った時、RUSH・時短（電サポ）の保留は Core の `fillReserveHolds` が変動開始と同じ時刻に最後尾へ足す自動保留。
- 次をテストで確かめる（`lcd-timeline.test.ts` か新しい `sakibare-timing.test.ts`。Engine を実際に進めて得たイベントで）:
  1. 通常時: 先バレの時刻 − 150ms = その保留の `holdAdded` の時刻 = 盤面の玉がヘソに入る表示の時刻（`BallTracks` の `start1` のコールバックの時刻と同じ表示時計）。差が 1 フレーム（17ms）を超えないこと。
  2. 保留が満タンの時にヘソに入った玉（保留が増えない）では鳴らない。
  3. RUSH: 先バレの時刻 − 150ms = 自動保留が**最後尾に**足された時刻（= 前の保留の変動開始）。保留の先頭（当該）に移った時・変動開始で再び鳴らない。
     大当たり後に RUSH へ入って自動保留がまとめて足される時は、同じ時刻の先バレの音は1回だけ（光は保留ごとでよい）。
  4. RUSH を数分進めて `LcdTimeline.resyncs` が 0（Projection へ揃え直すと取得時刻が消えて先バレが落ちる）。
- ずれ・抜けが見つかったらこのタスクで直す（直した内容を DECISIONS に1行）。合っていればコードは変えず、確認結果を STATUS Notes に。
Accept:
- [ ] 上の 1〜4 がテストになり `scripts/build.sh`・`scripts/test.sh all` が通る

### P13-T3 先バレの音を `先バレ音.mp3` に
Owner: Claude Code（Sonnet） | Read: spec/43-presentation-effects（音・パック）, spec/41-pwa-platform（Service Worker・プリキャッシュ）
Do:
- `apps/web/public/sounds/先バレ音.mp3`（人間が用意。約3.2秒・52KB。まだ git 管理外）を `apps/web/public/sounds/sakibare.mp3` に改名して追加する（URL を ASCII に）。
- `resources/packs/default/pack.json`: `sounds.sakibare` を `{ "file": "../../sounds/sakibare.mp3" }` に（`PACK_BASE` は `/packs/default/`）。
  シート `sakibare` は音を1回だけ（今の `at: 140` の2回目を消す）。光（保留のパルス）はそのまま。
  音量が他の SE より大きすぎ・小さすぎる時は、`SoundAsset` の file 形に任意の `gain`（0〜1、既定 1）を足して調整（`@ph/shared` の parse とテスト）。
- `apps/web/vite.config.ts` のプリキャッシュ `globPatterns` に `mp3` を足す（オフラインでも鳴る）。
- デコードに失敗したら鳴らさない（例外を投げない）。Debug の演出プレビューに「先バレ」を鳴らす項目が無ければ足す（実機で音を確かめるため）。
- テスト: pack の parse で `sakibare` が file 形・ファイルが `apps/web/public/sounds/` に在る・シートの音が1回。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る。ビルド成果物の SW マニフェストに `sounds/sakibare.mp3` が入っている
- [ ] 実機は T9 でまとめて確認

### P13-T4 当たる前に「大当たり中 4R」が出るのを直す
Owner: Claude Code（Sonnet） | Read: spec/40-app-ui（ホール・前面/背面）, spec/50-app-rendering（表示時刻）
Do:
- 原因: `hall-screen.tsx` の状態行（`大当たり中 {rounds}R・n連`・`大当たり n`・モード表示）は Engine の Projection（Engine の時刻）を出すが、
  盤面は `DISPLAY_LAG_MS`（1.3秒）＋ Engine の 1Hz 前進の分だけ遅れて図柄を止める（D-063）。そのため図柄が揃う前に文字が出る。
- 直し方: 盤面が実際に映している液晶の状態（`LcdTimeline.advance` の結果）から、ホールの状態行に要る値
  （大当たり中か・ラウンド・連チャン・モード・表示済みの大当たり回数）を小さな store（例 `stores/lcd-view.ts`。変わった時だけ set）に流し、状態行はそれを使う。
  盤面が無い・背面・Debug の倍速の時は今どおり Projection を使う。
- 同じ理由で結果を先に明かしていないかを確認して、あれば同じ store で揃える: 持ち玉の CountUp（出玉の入り方）・実績のトースト（大当たり回数の実績）・RUSH の連チャン数。
- テスト: Projection は大当たり中・液晶はまだ変動中 → 状態行に「大当たり中」が無い。液晶が大当たりに入った時に出る。RUSH の継続（st → 大当たり）でも同じ。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機は T9 でまとめて確認

### P13-T5 RUSH の変化保留を通常時と同じ尺に（色の付いた保留の変動に最短時間）
Owner: Claude Code（Opus） | Read: spec/21-core-lottery（変動パターン・変動時間）, spec/22-core-engine（決定論契約）, spec/43-presentation-effects（保留変化）
Do:
- 原因: RUSH・時短は電サポの自動保留で保留が常に3〜4 → `normal_short` が 2000ms（`SHORTENED_NORMAL_SHORT_MS`）、変動短縮でさらに ×0.9^n。
  fx の `holdBreakScale` が割れる演出（`HOLD_BREAK_MS` 5400ms）を 0.16 倍まで縮め、約0.7秒で割れて約1.2秒で図柄が止まる。
  通常時も保留3〜4の時は同じことが起きる。
- 直し方（Core）: 保留の最終色が**白以外**の変動は、変動時間を `spin_min_colored_ms` 以上にする（`max(短縮後の時間, 最短)`。保留数による短縮・変動短縮の後に適用）。
  値は 3機種の machine JSON に `"spin_min_colored_ms": 6600`（= `HOLD_BREAK_MS.end` 5400 + `HOLD_BREAK_MIN_REELS_MS` 1200。検証: 0〜120000 の整数）。
  白は変化しない（`planHoldChange`）ので、変化保留はすべて割れる演出を縮めずに見せられる。リーチ等の長い変動は変わらない。
- fx のテストに「3機種の `spin_min_colored_ms` ≥ `HOLD_BREAK_MS.end + HOLD_BREAK_MIN_REELS_MS`」を足す（Core は fx を import しないので fx 側で照合）。
- golden が変わる → 新しいハッシュと理由を DECISIONS に。spec/21 の変動時間の節に1行。
- 経済への影響を測る: `scripts/sim.sh econ --ev-hours 1000`（3機種）の EV が 1.05〜1.15（lt は 1.03〜1.17）のまま。RUSH 1回の平均時間の延びと、
  標準 1〜7日目の玉の内訳（行動 25〜45%）を変更前後で並べて `docs/state/econ-<日付>-p13.md` に。外れたら止めて Blockers に数値つきで。
- web のテスト: RUSH の色付き保留の変動で `holdBreakScale` が 1。
Accept:
- [ ] `scripts/test.sh core`（golden は新ハッシュが DECISIONS にある）・`scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] EV と内訳が基準内（econ の記録にある）

## 役物の強化（T6〜T8）の設計メモ
### 今の問題（人間の指摘と数値の当たり）
- 覚醒（spec/23）: Lv ≥ 100 で実行、**Lv を 0 に戻して**その役物だけ ×10、メダル `20 × 2^その役物の覚醒数`。
  最初に Lv100 に届くのはいつも最下位の風車（Lv100 で 400/秒程度）で、その頃の生産の数% しかない。×10 しても全体は数% しか伸びず、
  しかも Lv を 0 に戻すので買い直すまで**下がる**。20 枚（標準の行動で約半週）の重みに見合わない。pachisim の bot も「Lv≥100 の最初の役物」＝風車を覚醒している。
- 常連ツリー（spec/25）で役物に効くのは 開店祝い（風車 Lv25・回転体 Lv10 から＝誤差）と 開店セール（価格 −5%＝+0.37 Lv）だけ。生産の加算（+10〜30%）は役物の手応えにならない。

### 参考: Cookie Clicker（Wiki の Buildings / Upgrades / Sugar lumps / Heavenly upgrades の要点）
- **建物ごとの強化（tiered upgrades）**: 所持 1・5・25・50・100・150・… で開き、それぞれ「その建物 ×2」。価格は建物の基本価格の 10・50・500・5万… 倍。
  CpS の伸びの大半はこれ。→ PocketHeso では Lv 25/50/100/150… のマイルストーン（自動で ×2）が相当し、既にある。
- **相乗（Thousand fingers・Grandma 系）**: カーソルは「カーソル以外の建物 1 つにつき +0.1」、他の建物は「おばあちゃん n 人につき +1%」。
  **最下位の建物でも全体の数に比例して伸びる**ので、弱い建物への投資が無駄にならない。→ 覚醒の「共鳴」に採る。
- **砂糖塊（1日1個程度の希少資源）→ 建物レベル**: 失うものが無く、効果が積み上がる。→ メダル（行動でしか増えない）も同じ扱いにし、覚醒で Lv を戻さない。
- **永続スロット（Permanent upgrade slot）**: 転生で消える強化を1つ持ち越す。→ ツリーに「覚醒を閉店で保持」を採る。
- **Starter kit / Starter kitchen**: 転生後に建物を数個持って始める。絶対数なので後半は誤差 → 開店祝いを「前の周回の Lv の割合」にする。
- 判断の目安（Cookie Monster の payback）: 買い物は「価格 ÷ 増える CpS」で比べる。希少資源の買い物は 1 回で全体が目に見えて（×1.5 以上）伸びるのが気持ちいい。

### 新しい形（推奨。値は T7 で pachisim により決める）
1. **覚醒 v2（メダル）**
   - Lv を**戻さない**（`awaken.reset_lv: false`）。押した瞬間に伸びる。
   - 条件 `awaken.min_lv`: 100 → 候補 25 / 50（上位の役物も対象になり「どれを覚醒するか」を選べる）。
   - その役物 ×`awaken.mult`（×10 のまま、または Lv を戻さない分 ×3〜×5 に下げる）。
   - **共鳴**（相乗）: 今の周回の覚醒の総数 n につき、全役物 ×(1 + `awaken.resonance` × n)（候補 0.1〜0.25）。風車の2回目の覚醒にも意味が出る。
   - コスト: メダル `medal_base × medal_growth^その役物の覚醒数`（20・×2 のまま。覚醒の割引ノードもそのまま効く）。
2. **常連ツリーで役物を強くする**（不変条件1・2 は守る。不変条件4 の天井は測り直して DECISIONS に）
   - 覚醒の保持（永続スロット）: 段2「台の癖」= 風車〜クルーンの覚醒を閉店で保持、段3「台の記憶」= 全役物の覚醒を保持（`keep` の targets に `awaken_low`/`awaken_all`）。
     保持した覚醒は次の周回の覚醒の値段（覚醒数）にも数える。
   - 開店祝いを相対に: 開店時に「前の周回の各役物の最高 Lv × 割合（開店祝い 10%・上 25%）」から（新しい effect `starter_rel`。今の絶対 Lv の starter は置き換え）。
   - 共鳴を強くする: 段3/段4 に「共鳴 +0.05」（effect `resonance_add`）。
   - 開店セール（−5%・−5%）は据え置き（価格は他の強化で十分に効くため）。
3. **見せ方**: 強化タブの覚醒ボタンに「覚醒すると 生産 ×a（+b%）」の予告（Projection に足す。CC の payback 表示に相当）。ツリーの役物系ノードにも「今の周回なら 生産 ×a」。

### 体感の目標（T7 の合否。pachisim の標準 greedy・3機種）
- 覚醒の直後の perSec(fg) の伸び: 1周目の初覚醒で **×1.5 以上**。各周回の覚醒の中央値 ×1.3 以上。最下位（風車）の2回目でも ×1.1 以上（共鳴）。
- 覚醒の保持を買った次の周回: 開店から24時間の平均 perSec(fg) が、買わない時の ×2 以上。
- 守る: 閉店日と各回の gain が今と一致（不変条件1。メダルの使い道が増えても累計獲得メダルは減らない）・行動なしは常連P 0・EV ≤ 1.30・Infinity/NaN なし。
- 動いてよいが記録する: 初覚醒の日（今 3〜4日目）・1閉店の常連P（runBonus が増えるなら `tree.run_bonus_at` を上げて 10〜16 に戻す）・実績の達成数（+3 以内に収まらなければ表に出して人間判断）・検証 5・6 の比。

### P13-T6 Core: 覚醒 v2・共鳴・ツリーの新しい効果（値は今と同じで入れる）
Owner: Claude Code（Opus） | Read: spec/23-core-economy（役物・覚醒・閉店・計算ルール）, spec/25-core-prestige-tree（効果の種類・不変条件・保存）, spec/22-core-engine（Action・Projection・決定論契約）
Split: Opus — Core（economy-state・tree・保存・Projection）/ Sonnet — pachisim（覚醒の選び方・ログの列）と既存テストの直し
Do:
- まず今の状態を測って記録する（`docs/state/econ-<日付>-p13.md` の「変更前」）: 標準 84日（3機種）で、覚醒ごとの「日・対象・直前/直後の perSec(fg)・比」。
  pachisim に覚醒のログ（`awaken day=… target=… before→after ×比`）を足す。
- `default.json` の `awaken` に `reset_lv`（既定 true）・`resonance`（既定 0）を足し、`min_lv`・`mult` と同じく検証。
  **今の値（reset_lv true・resonance 0・min_lv 100・mult 10）では今と完全一致**（golden 不変）にする。
- 覚醒: `reset_lv: false` なら Lv を残す。共鳴: perSec の役物の合計に ×(1 + resonance × 今の周回の覚醒の総数)（乗算の表に入れる。禁止演算なし）。
- ツリーの新しい効果（spec/25 の効果の種類に足す）: `keep` の targets `awaken_low`（風車〜クルーン）/`awaken_all`、`starter_rel`（前の周回の最高 Lv × 割合、切り捨て）、`resonance_add`。
  前の周回の最高 Lv を閉店時に保存（IdleEconomy v9。v8 以前は全 0）。ノードの追加・値は T7（ここでは効果の実装とテストだけ。default.json のノードは変えない）。
- Projection: 覚醒できる役物ごとに「覚醒後の perSec ÷ 今の perSec」（表示用。燃料・前面の状態係数は掛けない基準生産で）。
- pachisim: 覚醒の選び方を「覚醒できる役物のうち、覚醒後の perSec が最大のもの」に（reset_lv true の時は今と同じ選び方を残すオプション `--awaken-pick first|best`、既定 best）。
- テスト: reset_lv false で Lv が残る・共鳴の倍率・awaken_keep で閉店後も覚醒と覚醒数が残る・starter_rel の切り捨てと前周回 0 の時・v8 のセーブを読める・snapshot/restore の往復。
Accept:
- [ ] `scripts/test.sh core` が通る。golden は不変か、保存項目（v9）が増えただけの変化であることを確かめて新ハッシュを DECISIONS に
- [ ] `scripts/build.sh` の lint（禁止 API・禁止演算・反復順依存なし）
- [ ] econ の記録に「変更前」の覚醒の表がある

### P13-T7 値を決める（試算）と spec の更新 → 人間の OK
Owner: Claude Code（Opus） | Read: spec/23-core-economy（覚醒・バランス目標）, spec/25-core-prestige-tree（ノード一覧・不変条件・検証）
Split: Sonnet — 候補ごとの pachisim の実行と表づくり / Opus — 候補の選定・合否・default.json・spec・DECISIONS
Do:
- 上の「新しい形」の候補（min_lv 25/50 × mult 3/5/10 × resonance 0.1/0.15/0.25）を pachisim で比べ、「体感の目標」を満たす最も控えめな組を選ぶ。
- ツリーに新ノードを足す（覚醒の保持 2 つ・共鳴 2 つ。開店祝い・上 を starter_rel に置き換え）。段・コスト・前提は spec/25 の段の考え方（段ごと ×2〜3）に合わせ、
  「何週目に何が買えるか」の表を測り直す。不変条件4 の天井を測り直して spec/25 と DECISIONS に（新しい乗算の系統＝共鳴を足す理由も）。
- spec/23 の覚醒の節とバランス目標（初覚醒の日）、spec/25 のノード一覧・効果の種類・検証を更新。golden が変わったら新ハッシュを DECISIONS に。
- 結果（変更前後の覚醒の伸び・保持ノードの効き・守る項目・動いた項目）を econ の記録にまとめ、**人間に要約の表を渡して OK をもらう**（STATUS の Blockers に「P13-T7 の人間 OK 待ち」）。
Accept:
- [ ] `scripts/test.sh core`・`scripts/build.sh` が通る
- [ ] 体感の目標と守る項目が econ の記録で全て OK（NG は数値つきで Blockers）
- [ ] 人間の OK（STATUS Notes に記録）

### P13-T8 web: 覚醒・新ノードの見せ方
Owner: Claude Code（Sonnet） | Read: spec/23-core-economy（覚醒）, spec/25-core-prestige-tree（画面）, spec/40-app-ui（強化タブ）
Do:
- `SNAPSHOT_VERSION` +1（前の版も読む）。
- 強化タブの覚醒: 文言から「Lv が 0 に戻る」を消し、ボタンに「覚醒すると 生産 ×a（+b%）」（Projection の値。×1.01 未満は「+1% 未満」）。共鳴の今の倍率を役物一覧の上に1行。
- 常連ツリー: 新ノード（覚醒の保持・共鳴・相対の開店祝い）の説明と「今の周回なら 生産 ×a」。閉店カードに「保持される覚醒」を1行。
- 覚醒の瞬間に短い演出（既存の素材。演出パックに `awaken` が無ければ `hold_gold` 相当を流用）。
- web のテスト: 予告の倍率の表記（×1.01 未満・×10 以上）・保持される覚醒の表記。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る

### P13-T8b カスタムの先バレは必ず変化保留にする（T1 の「先バレと変化を切り離す」を取り消す）
Owner: Claude Code（Opus） | Read: spec/43-presentation-effects（保留変化・先バレ）, spec/21-core-lottery（保留色・確率）
Split: Opus — fx の式・乱数・統計テスト（Do の fx）/ Sonnet — web の接続・テスト・spec/DECISIONS（Do の web 以降）
背景: 人間の実機確認（10/21）。T1 は「先バレは音と光だけで保留は変化しない」にしたため、先バレしても熱い演出が来ず、先バレの意味が伝わらない。
リゼロ等の実機は「先バレ → 変化保留（青・赤など。弱い色でハズレもある）→ 結果」の流れ。例: 信頼度40% なら 先バレ → 赤保留 → ハズレ もある。
Do:
- 方針: **カスタムの先バレは、必ず変化保留（灰色の点滅 → 自分の変動開始で割れて最終色が出る）になる**。最終色は Core が取得時に決めたまま（保留色の信頼度は変えない）。
  先バレの信頼度 r（P(当たり | 先バレ)）は各カスタムの値のまま。`normal` は今のまま（D-074。もともと先バレなら変化する）。先バレしない保留の変化は今のまま（`planHoldChange` の `change`）。
- 制約と式: 変化できるのは最終色が白以外の保留だけ（白は変化しない）。よって先バレは**最終色が白以外の保留に限る**。
  - 当たり: 白以外の保留に確率 `a`、ハズレ: 白以外の保留に確率 `b`（白は 0）。`a`・`b` は色ごとに変えてよい（赤・金に寄せる等は任せる）。
  - r を各機種・各モード（通常/時短 `hold_colors`、ST/LT `hold_colors_st`）で**厳密に**満たす: `a·H = r·(a·H + b·M)` の形（H = 当たりの白以外の割合×p、M = ハズレの白以外の割合×(1−p)、p = 取得時のモードの当選確率）。
  - 占有率 o（P(先バレ | 当たり) = `a`·(当たりの白以外の割合)）は**上限つき**: 白の当たりには先バレできず、b ≤ 1 の制約もある。
    実効の o = min(カスタムの o, 満たせる最大) とし、r は絶対に変えない。参考: 通常/時短は当たりの約95%が白以外なので sb40/sb90/sb100 の o はほぼ満たせる。
    ST/LT は当たりの白以外が約60% なので sb40(95%)・sb90(90%) の o は約60% 以下に下がる。実効 o の表（機種 × モード × カスタム）を `docs/state/` の試算メモに残す。
  - 乱数は `RNGStream(seed, 'holdChange', serial)` の既存の流れの後ろ（3番目以降）を使う。最終色・先バレしない保留の変化は T1 の時点と変わらない。
- fx: `planHoldChange` の姉妹 `planHoldChangeCustom(seed, serial, final, hit, p, custom): HoldChangePlan`（`sakibare` なら `change: true`）を足し、
  `planSakibare` はその `sakibare` を返す形にまとめる（式・乱数の流れが二重にならないように）。特別保留・ボーナス保留（通し番号 1e9〜2e9）は従来どおりカスタム時は先バレしない。`normal` は完全一致。
- web: 保留の見せる色（`holdColorAt`・`shownLcdState` ほか `planHoldChange` を呼んでいる箇所）を、取得時のカスタム・当否・モードを持つ保留では `planHoldChangeCustom` に切り替える。
  取得後に設定を変えても既に取った保留の見え方は変わらない。当否が分からない保留は今どおり先バレしない。割れる演出・最短時間（T5）・hold_crack/hold_<色> の音はそのまま。
- 設定画面のカスタムの説明を直す: 「先バレが鳴った保留は必ず変化する（色が上がっても外れることがある）」。実効 o が下がる ST/LT の注記は出さなくてよい（spec に書く）。
- spec/43 の抽選カスタムの節を直す（先バレ ⇒ 変化、白は先バレしない、実効 o）。DECISIONS に D-番号で3行以内（T1 の「切り離す」を取り消した理由・白を除く・o は上限つき）。
- テスト:
  - fx: 3機種 × 通常/ST の表で、各カスタムの実測の r が ±0.02 以内（20 万保留程度）・実測の o が実効 o の ±0.02 以内。`sakibare` なら必ず `change`・最終色は白以外。`sb100` はハズレで先バレしない。
    `normal` と先バレしない保留の `final`・`change` は T1 の時点と全 seed で一致。同じ引数なら同じ結果。
  - web: 先バレした保留は取得時に灰色（白）で出て、自分の変動開始から 4500ms で最終色に変わる。取得後に設定を変えても既に取った保留は変わらない。特別保留は先バレしない。
    `sakibare-timing.test.ts` は新しい式でも通る。
- Opus が実効 o の表を見て、仕様の意図（r 優先・o は下がってよい）から外れる場合は止まって人間に聞く。
Accept:
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る（Core は無変更）
- [ ] 実機は T9 でまとめて確認

### P13-T9 実機確認
Owner: 人間（手順は Claude Code（Sonnet）） | 前提: P13-T1〜T8b
Do: `dev` を push し、人間に手順を渡す（Debug で RUSH・閉店・メダルを用意してよい）:
1. 設定 → 抽選カスタムで4種を切り替えられる。`先バレ 100%` で先バレした保留が必ず当たる（何回か）。ホールに「カスタム 先バレ100%」が出る。
2. 先バレ音が `先バレ音.mp3` で鳴る。通常時はヘソに入った瞬間、RUSH 中は保留が最後尾に追加された瞬間。
3. 通常の大当たりと RUSH の継続で、図柄が揃う前に「大当たり中 4R」等が出ない。
4. RUSH 中の変化保留が通常時と同じ速さで割れる（すぐ終わらない）。
5. 覚醒: Lv が戻らず、押した瞬間に生産が目に見えて上がる。予告の倍率と実際の伸びが合う。ツリーの覚醒の保持が閉店後に効いている。
6. カスタム（`先バレ 40%` など）で、先バレが鳴った保留は必ず灰色の点滅で出て、変動開始で割れて色が出る（青など弱い色でハズレもある）。先バレが鳴らない保留が変化することもある。保留が満タンの時に入った玉では鳴らない。
   等倍で見るには `/?debug=1&sandbox=1`（Debug の「x1（別セーブ）」）で Grant 注入して玉・燃料を用意する。
結果を STATUS Notes に。
Accept:
- [ ] 実機（人間）: 上の 1〜6 が OK

### P13-T10 v1.4.0 のリリース（main へ）
Owner: Claude Code（Sonnet） | Read: ref/tooling（デプロイ） | 前提: **人間の「リリースしてよい」の指示**。T1〜T9 が OK
Do: P8-T6 の手順 1〜4 と同じ。ルート `package.json` の version を 1.4.0 にしてからタグ `v1.4.0`。
本番確認は: Debug が無い・バージョン v1.4.0・既存セーブで開ける（覚醒した役物の Lv がそのまま）・抽選カスタムと先バレ音が使える。
Accept:
- [ ] `main` と `dev` が同じコミットで、`v1.4.0` タグが付いている
- [ ] 本番の確認が人間から OK
