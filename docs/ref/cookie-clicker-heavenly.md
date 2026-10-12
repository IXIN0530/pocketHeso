# Cookie Clicker 転生・天国チップ・天国ツリー 調査メモ

目的: PocketHeso（閉店＝転生、常連P＝天国チップ）の設計参照用。調査日 2026-10-12。
情報源の注意: Fandom wiki は取得不可（HTTP 402）。主に Cookie Clicker Wiki (wiki.gg) と攻略ページを使用。
「未確認」は一次情報で裏取りできていない項目。ゲーム本体の現行バージョンで値が変わる可能性あり。

## 1. 転生の基本
出典: https://cookieclicker.wiki.gg/wiki/Heavenly_Chips / https://cookieclicker.wiki.gg/wiki/Prestige / https://cookieclicker.wiki.gg/wiki/Ascension

### 獲得式
- 累計 baked cookies（全周回の合計 "cookies baked all time"）を x とすると、
  prestige level の総量 P_total = (x / 1e12)^(1/3)（端数切り捨て。丸め規則は wiki に明記なし、実装上は floor と推定=未確認）
- 今回の転生で得る天国チップ = P_total - 現在の prestige level。**prestige 1 レベル = 天国チップ 1 枚（1:1）**。
- 例（wiki 記載どおり）: 1e12 → 1、1e15 → 10、1e18 → 100、1e21 → 1,000（累計が 1000 倍ごとに prestige は 10 倍）。
- 逆算: prestige P に必要な累計 = P^3 × 1e12。つまり必要累計はレベルの 3 乗で増える。
- 転生は **+1 以上増える場合のみ**可能。
- 重要: 計算に使うのは「全周回の累計」。前周の分は既に反映済みなので、次の転生で増えるのは P_total の差分。

### 生産倍率
- **prestige level 1 につき CpS +1%（加算）**。Legacy 購入後に有効。
- 倍率の根拠は「獲得した累計チップ（= prestige level）」であり、**チップを使って（消費して）も倍率は下がらない**。チップは「使う通貨」と「倍率の源泉」を兼ねる。
  （ユーザー指示の「チップ1つ+1%」は概ね正しいが、正確には prestige level に対する +1%。）
- 例: prestige 1,000 → CpS ×11（+1000%）。prestige 100 万 → ×10,001。ここは線形加算なので後半は単独では支配的でなくなり、他の乗算（アップグレード・シナジー）が効く。
- Lucky Digit/Number/Payout: prestige level の数字に 7 が含まれる（1/2/4 個）と各 +1% prestige CpS など（「ぴったりの数字」を狙わせる遊び）。

### リセットされるもの / 残るもの
- リセット: cookies、建物、通常アップグレード、実績以外の周回内進行、ウリンクラー/トナカイ弾き進行。庭の作物（植え付け済み）。
- 保持: 天国アップグレード全部、prestige level、実績（とその効果）、庭の種ログと庭サイズ、Permanent upgrade slot に入れたアップグレード。
- Keepsakes 取得後は季節ドロップが 1/5 で引き継がれる。
- 「転生時にもらえる初期状態」: Starter kit（カーソル10）、Starter kitchen（おばあちゃん5）などは天国アップグレードで購入。
- Challenge Mode: 天国アップグレードを使わない縛りで新規開始を再現できる（転生画面の選択）。

## 2. 天国アップグレードの全体像
出典: https://cookieclicker.wiki.gg/wiki/Ascension （コストは HC=天国チップ）、補助: https://gamepretty.com/cookie-clicker-ascension-and-permaslots-guide/

### 構造
- ツリーは「Legacy（1HC）」が根。ほぼ全てが Legacy から枝分かれし、各ノードは**親ノード購入で解放**（親が複数＝AND の合流ノードもある: 例 Synergies Vol.II = Vol.I + Seraphim + Beelzebub）。
- 路線は大きく分かれるが、**コストが 7 の冪（1,7,49,343,2401,16807,117649,823543）で伸びる直線チェーン**が多い（オフライン系）。
- 全部買う総コスト: 74,938,145,064,647,592 HC（約 7.5e16）。wiki 記載。

### 主な系統と代表コスト（HC）
| 系統 | 代表 | コスト・効果 |
|---|---|---|
| 土台 | Legacy | 1。以後 prestige×1% CpS が有効 |
| 基礎倍率 | Heavenly cookies | 3。生産 +10% 永続 |
| 基礎倍率 | Heralds | 100。herald 1 つにつき +1% CpS（オンライン接続等で変動=詳細未確認） |
| 基礎倍率 | Wrinkly cookies | 6,666,000。+10% |
| 基礎倍率 | Sugar crystal cookies | 1e9。+5% ほか |
| オフライン | Twin Gates → Angels…God | 1→7→49→343→2,401→16,807→117,649→823,543。オフライン効率 5%→最大 75%（各+10%） |
| オフライン時間 | Belphegor…Lucifer | 7→…→823,543。最適オフライン時間 2h→4h→8h→16h→1日8h→2日16h→5日8h |
| 永続スロット | Permanent upgrade slot I〜V | 100 / 20,000 / 3,000,000 / 4e8 / 5e10。通常アップグレードを転生後も維持 |
| 利便性 | Persistent memory | 500。研究 10 倍速 |
| 利便性 | Inspired checklist / Genius accounting / Label printer | 900,000 / 2,000,000 / 5,000,000（一括購入・UI 補助） |
| 黄金クッキー | Heavenly luck | 77。出現 +5% |
| 黄金クッキー | Lasting fortune | 777。効果時間 +10% |
| 黄金クッキー | Golden switch | 999。常時 +50% CpS だが黄金クッキー無効（切替可） |
| 黄金クッキー | Decisive fate / Residual luck | 7,777 / 99,999 |
| 割引 | Divine discount・sales・bakeries | 99,999 / 99,999 / 399,999。建物-1%・アップ-1%・クッキー系 5 倍安 |
| ミルク/子猫 | Kitten angels | 9,000。ミルク量に応じ CpS 増。Kitten wages/Cat ladies は 9e9 |
| スターター | Starter kit / Starter kitchen | 50（要 4 種のクッキー各 25）/ 5,000。転生後の初期カーソル・おばあちゃん |
| 季節 | Season switcher | 1,111（Heralds 要）。Starspawn 他 5 種 各 111,111、Keepsakes 1.111e9 |
| ウリンクラー | Unholy bait / Sacrilegious corruption / Elder spice | 44,444 / 444,444 / 444,444 |
| シナジー | Synergies Vol.I / II / Chimera | 222,222 / 2,222,000 / 40,354,000（建物間のアップグレード解放） |
| 砂糖塊 | Stevia Caelestis ほか | 1e8〜1e9。成熟短縮・Sugar baking（未使用塊 1個につき+1%）等 |
| Unshackled | 各建物の上位ティア解放 | 1e7 から 1.92e16 まで連なる最終盤の延長 |
| 終盤の装飾・利便 | Fortune cookies | 7.7778e10。ニュースティッカーの運勢クリック |
- なお、ミルク（Milk）系は prestige ではなく**実績数**で決まる。prestige はミルク量を増やさない（wiki）。
- モバイル版はオフライン系が Power Clicks に置換される（同コスト帯）。PocketHeso の「放置と能動の分離」の参考になる。

### コストの段階感（HC）
- 序盤（1〜1,000）: Legacy、Heavenly cookies、Heralds、Slot I、Heavenly luck、Starter kit、Lasting fortune など。
- 中盤（1e3〜1e6）: Persistent memory、Kitten angels、Slot II、Golden switch、シーズン系、Synergies Vol.I、割引、Fortune など。
- 後半（1e6〜1e9）: Slot III/IV、Synergies II、Chimera、Lucky Payout、砂糖塊系。
- 終盤（1e9〜1e16）: Unshackled 系、Shimmering veil、Milkhelp、Pet the dragon 等。
- つまり**コストは約 10 倍刻みで広がる**。1 回の転生で得られる HC の桁と購入対象の桁が揃うよう設計されている。

## 3. 周回の進め方・タイミング
出典: https://cookieclicker.wiki.gg/wiki/Prestige （推奨マイルストーン）、https://gamepretty.com/cookie-clicker-ascension-and-permaslots-guide/ 、https://www.pocketgamer.com/cookie-clicker/ascension-guide

### wiki / 攻略ページの目安
- 初回転生: 累計 1e12 で +1 だが、**約 365〜440 HC を目標**にする（wiki は 365: Legacy, Dragon, Heavenly cookies, Heralds, Heavenly luck, Slot I）。攻略ページは 440（Starter kit 一式を含む）。累計では 440^3 ×1e12 ≒ 8.5e19 付近。
- 2 周目: wiki は 2,185 HC（累計 prestige 2,550）で Starter kit, Season switcher, Golden switch。
- 攻略ページの標準順序（累計 prestige / 転生回数）: 440 → 3,327 → 36,912 → 162,088 → 1.0e6 → 4.1e6 → 1.7e7 → 2.9e7 → 1.07e8 → 3.5e8 … → 約 2.2e12（19 周）。
  **おおむね「次の転生で累計が 3〜10 倍になる」まで待つ**考え方（序盤は倍々、後半は桁が上がる）。
- 別ガイドの目安（SEO 的なページで信頼度は低い）: 「以降は HC が倍になるたび」「次の 1 レベルに 1 時間以上かかる壁が来たら」。
- 用語（pocketgamer）: prestige 1,000 未満の転生を fast、100,000 以降を slow と呼ぶ。新規には fast 推奨。

### 理論の骨子
- 転生を待つ理由: 必要累計がレベルの 3 乗なので、**レベルを 2 倍にするには累計が 8 倍必要**。一方で CpS は prestige に線形（+1%/level）なので、後半は転生しても得られる倍率の増え方が鈍い。
- 転生を早める理由: 得た HC で永続スロット・黄金クッキー・オフライン等の乗算系を買い、次周の速度が上がる。
- 実際の判断: 「今の周回の残り時間で得る HC の増分」vs「転生して次周で再び同じ地点に戻る時間」。現在の prestige が大きいほど、次周の序盤は速くなる（+1% × prestige）。
- 数周〜数十周のペース感: 序盤 3 周は数時間〜数日、10 周目以降は 1 周が数日〜数週間（プレイ時間は個人差が大きい=未確認、確実な統計はなし）。
- 天国チップが次周に与える速度: prestige 100 → ×2、1,000 → ×11、10 万 → ×1,001（CpS のみ。他の永続スロットや黄金系と掛け合わせて実感はさらに大きい）。

## 4. 良い点・悪い点
出典: https://steamcommunity.com/app/1454400/discussions/ （個別スレッド、システマチックな調査ではない）。以下は一部私見を含む（明記）。
### 良い点（プレイヤー評価として一般的）
- 転生ごとに「確実な前進」がある。倍率は購入しなくても自動で乗る（+1%/level）ので、買い物の失敗がない。
- 序盤の小さい買い物（3 HC, 25 HC…）が次周の体感を大きく変える。
- 永続スロットで「周回の戦略の自由度」が生まれる。Lucky Digit 系の遊び心。
- オフライン系の拡張で、放置派・能動派が選べる。
### 悪い点・不満
- 終盤のコストが巨大（1e9〜1e16 HC）。数字の意味が薄れる。
- 初回転生まで待たされる（440 目標との議論がある: 「400+ 待つのは初心者に現実的か」）。
- ツリーが**直線チェーン**気味で、選択の余地が小さい（私見・要裏取り=未確認）。ほぼ全部買う前提で、順序の最適解が攻略ページに固定される。
- mod の変更履歴から、ベースのツリーのバランスや内容に不満を持つ人が一定数いる様子。
- 7 や 9 など数字のこだわりが分かりにくい（Lucky 系は prestige の桁を表示設定で確認要）。

## 5. 他の放置ゲームの類似仕組み（比較）
- **Adventure Capitalist / Angel Investors**（出典 未取得: Fandom が 402）: 累計収益の平方根的な式で Angel を得て、Angel 1 体あたり +2% 収益。リセットは任意。式の詳細は未確認。Angel は使わない選択もできる点が特徴で、「使うと倍率が減る」ゲームもある（本作では未確認）。
- **Realm Grinder**: https://www.pcgamer.com/realm-grinder-guide/ 。Abdicate（1 回目のソフトリセット）と Reincarnation（gems 1 octillion=1e27 で解禁、2 回目）。Excavation（採掘）で faction coins・遺物を得て、リセットを重ねるほど新しい階層が開く。「リセットの段階化」が特徴。
- **Revolution Idle / Promotion**: https://revolutionidle.wiki.gg/wiki/Promote 。P.Mult が x1000 を超えると Promotion 可能。「少なくとも 1〜2 桁伸びてから」が推奨。昇進時に 4 つのブーストのどれを上げるか選べる。
- 共通点: (a) 累計に応じた逓減（立方根・平方根など）、(b) リセットは任意で「何周目か」が戦略、(c) 永続通貨は倍率と購入の両方に使う設計が多い。

## 6. PocketHeso への示唆（8 項目）
1. 常連P = 累計営業成果の立方根（または平方根）で付与。**必要累計がレベルの 3 乗**になるため、1 回の営業で稼ぐ量と必要労力のバランスを「3 乗 ≒ 次の 1 レベル」で説明できる。
2. 倍率は常連P（総獲得量）に比例する **+x%/P の加算**で、消費しても減らない設計にすると、買い物の失敗が無くなり放置ゲームに向く。
3. 初回転生（初閉店）の目標 HC を決め、**買えるもの一覧を最初の画面で見せる**（Legacy, Heavenly cookies 相当の安い 3 つ程度）。「待つ価値」が見える。
4. コストは **約 10 倍刻み**。1 回の閉店で得る P の桁と購入対象の桁を揃えて「毎回何か買える」ようにする。
5. ツリーは親子（AND/OR）で解放する。直線すぎると退屈になるので、**分岐 2〜3 本 + 合流ノード**程度にして、順序の選択が意味を持つ程度の複雑さに留める。
6. 永続スロット的な仕組み（通常アップグレード 1 つを閉店後も持ち越し）は、少数のコストでプレイの幅を作れるので採用候補。
7. 営業時間（運動報酬）は周回内の資源だが、転生後に持ち越さない設計か持ち越す設計かを明確に。Cookie Clicker ではオフライン系が 7 の冪でコスト増、時間は最大 5 日強まで延びる。ストック上限の段階強化が参考になる。
8. 終盤の天文学的数値は避け、**短い上限（例: 15〜20 段階）**で閉じる。Cookie Clicker は総コスト 7.5e16 まで膨らみ、数字の意味が薄れるという不満が出ている。また、Lucky Digit のような遊びは任意の小ネタに留める。
