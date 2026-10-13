# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P10（常連ツリー: 常連Pの使い道・数ヶ月遊べる設計）→ `docs/plan/P10-prestige-tree.md`。最優先。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P10-T6（常連ツリーの画面: tree-sheet・強化タブの行と番頭さん・閉店の内訳と「常連ツリーへ」・ホール HUD の開店ダッシュ札・呼び名をランク/常連P にそろえた。実機確認は人間待ち）
- Next: P10-T7（見た目の解放と演出）
- Owner hint: Claude Code（Sonnet）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- **P10-T5 検証 5・6 の 2 週が NG（人間判断、T6 以降は進めてよい）**: 開店ダッシュを割り戻すと 12週中10週は 3.7〜5.4 だが、lt r74 3週目 6.08（基準 ≤5.5）・rush r180 4週目 7.00（≤6.0）。役物 Lv の段差による一時的な週。A そのまま（推奨）/ B densetsu・meiten の prod_add を下げて再試算。詳細 `docs/state/econ-20261013-p10.md`・D-105
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P10-T6]: 系統は JSON に欄が無いので `engine/tree-defs.ts` に id→系統の表（52個、テストで全件確認）。開店ダッシュの倍率は所持ノードの open_boost から web で計算（TreeView に倍率が無いため）。Debug に常連P を入れる口は無い: 実機は既存セーブ（ランク≥1 なら 10×ランク）か、Debug の x3600 で閉店まで進めて得る。全部 Sonnet
- [P10-T5]: 暫定の比 6〜9.8 は閉店日の日末に開店ダッシュ ×2.5 が乗ったため。econ の `perSecFgNoDash` で割り戻して判定（D-105）。R/T の初回閉店は runBonus 0 で常連P 10（基準の下限を 10 に）。lt の EV 1.36 はツリーと無関係の既存値。重い試算は 182日 1本 約45分。econ.ts・検証の実行は Sonnet、判定・再計測・spec/DECISIONS は Opus
- [P10-T4]: 番頭さんは economyTick の直後（並び economyTick → 番頭さん → achieved）で、留守中サマリーでは使った玉を発射と同じく足し戻す。notice_auto は背面なら受け取らず、期限内に前面へ戻った時刻に受け取る。遅れ0は出現と同時。ShopView の閉店見込みは既存の `close.points`（名前は nextClosePoints にしていない）。テストは tree-engine.test.ts 7件。web と spec/22 は Sonnet
