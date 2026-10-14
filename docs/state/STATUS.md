# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P11（v1.2 の手直し → `docs/plan/P11-feedback-1-2.md`）。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P11-T1（留守サマリー: 5分未満は出さない・タップ不要のバナー・D-106。build/test OK、実機は T5）。その前: P10-T9（v1.2.0 を main へ ff マージ・タグ v1.2.0 を push。build/test/release-check OK）。本番の確認は人間待ち。その前: P10-T8（実機 OK）
- Next: P11-T2（閉店カード: 常連ランク・常連P の計算式。Core に表示用の値を足す）
- Owner hint: Claude Code（Sonnet）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- v1.2.0 の本番確認が人間待ち（Debug が無い・バージョン v1.2.0・既存セーブで常連P・ツリーで開けて閉店後も残る）
- **P10-T5 検証 5・6 の 2 週が NG（人間判断、T6 以降は進めてよい）**: 開店ダッシュを割り戻すと 12週中10週は 3.7〜5.4 だが、lt r74 3週目 6.08（基準 ≤5.5）・rush r180 4週目 7.00（≤6.0）。役物 Lv の段差による一時的な週。A そのまま（推奨）/ B densetsu・meiten の prod_add を下げて再試算。詳細 `docs/state/econ-20261013-p10.md`・D-105
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P11-T1]: バナーはタブバーの上（fixed）に全タブ共通で出す（ホール上部のトーストと重ならないため）。ストアに `awayBanner` を足し、タップで `away`（シート）に移す。規則は `stores/away.ts`。全角スペースは lint で弾かれるので半角2つ。Sonnet
- [P10-T8]: 実機確認 OK（人間）。Debug に常連P/番頭さんの直接付与は無く、x3600 で閉店を重ねて確認した。T9 は人間のリリース指示まで着手しない。Sonnet
- [P10-T7]: 見た目は `board/look.ts` の resolveLook(所持unlocks, looksOff)→BoardScene.setLook。dendou は金の筐体が chrome より優先、称号は HudCanvas の隅に常時描画。実機で見るには Debug の x3600 で閉店→常連P→段1の lamp_gold(5P)等を購入（金の玉は段4・殿堂入りは段5で遠い）。core の tree-engine.test の 24h advance 1.5倍判定は負荷で稀に落ちる（再実行で通る、今回触っていない）。全部 Sonnet
