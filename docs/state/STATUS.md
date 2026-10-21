# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P13（v1.4 抽選カスタム・先バレ・役物の強化 → `docs/plan/P13-feedback-1-3.md`）。P11-T6 の本番確認は Blockers。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P13-T8c（ST・LT もカスタムの占有率どおり。白以外を先に使い、足りない分だけ白の保留にも先バレ → 割れて色が出る。見せる色は色の信頼度を変えない重み, D-117）
- Next: P13-T9（実機確認。手順は T8c の報告で渡した）→ T10 は人間の「リリースしてよい」待ち
- Owner hint: 人間（T9 の実機）→ Claude Code（Sonnet）（T10 は人間の指示時）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- v1.2.1 の本番確認が人間待ち（Debug が無い・バージョン v1.2.1・短い留守でサマリーが出ない・オート打ちの設定が崩れない）
- v1.2.0 の本番確認が人間待ち（Debug が無い・バージョン v1.2.0・既存セーブで常連P・ツリーで開けて閉店後も残る）
- **P10-T5 検証 5・6 の 2 週が NG（人間判断済み: A そのまま, D-115、T6 以降は進めてよい。P12-T2 の測り直しでも同値: `--tree all` は休業の影響を受けない）**: 開店ダッシュを割り戻すと 12週中10週は 3.7〜5.4 だが、lt r74 3週目 6.08（基準 ≤5.5）・rush r180 4週目 7.00（≤6.0）。役物 Lv の段差による一時的な週。A そのまま（推奨）/ B densetsu・meiten の prod_add を下げて再試算。詳細 `docs/state/econ-20261013-p10.md`・D-105
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P13-T8c]: 通常・時短は T8b と同値。ST・LT の sb40 は白の当たり 87%・白のハズレ 0.6%、sb90 は白の当たり 75% に先バレ（表 `docs/state/sakibare-occ-20261021.md`）。sb90 の白の先バレは全部金で見せる（金の信頼度 95→98%、RUSH で金が約3倍出る）。見た目の熱さと Core の熱さ（白）が合わない保留あり。`tree-engine.test.ts` の時間比較が全体実行で1回不安定（今回は無関係・再実行で通過）。Opus が fx、Sonnet が web テスト・spec・DECISIONS
- [P13-T8b]: 実効 o は通常/時短がカスタムの値、ST/LT は 3 カスタムとも 60%（白の当たり 40% に先バレできない）。表は `docs/state/sakibare-occ-20261021.md`。`LOTTERY_HOLD_COLORS` は白が最後。`sakibare-timing.test.ts` の件数下限を 20→10（白に先バレしなくなり件数が減った。時刻の確認は不変）。Opus が fx、Sonnet が web・spec・DECISIONS
- [P13-T9 補修]: 等倍で Grant 注入できなかったので `?debug=1&sandbox=1`（x1 のまま別 DB `pocketheso-debug`）を追加。Debug 画面に「x1（別セーブ）」リンク。本番ビルドでは無効
