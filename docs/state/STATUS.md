# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P10（常連ツリー: 常連Pの使い道・数ヶ月遊べる設計）→ `docs/plan/P10-prestige-tree.md`。最優先。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P10-T1（default.json に tree 52 ノード・`tree-config.ts` で読み込みと検証・型を export。golden 不変）
- Next: P10-T2（IdleEconomy: 常連P の通貨・購入・保存 v7）
- Owner hint: Claude Code
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P10-T1]: spec/25 の未決事項は推奨のまま進行（人間の返事待ちではない）。検証に足したもの: 開かない段（下の段の数が tier_unlock に届かない）もエラー。機種名の照合は `treeUnknownMachines`（警告用）。economy-state.test の手計算用 JSON は medal_base・closed を変えるので tree を外した
- [P10]: 常連ランク（既存の常連P・式は不変）と使う通貨「常連P」を分けた。52ノード・5段・総1,108P・標準で全取得約12か月。数値は Python 概算で、実測は P10-T5。未決は spec/25 末尾（推奨で進行可）
- [D-099]: 玉の期待値は `sim econ` の実測で合わせた（変更前は初期 約1.07。理論値 `sim run` は0.90〜0.98 で実測より低い）。当たり率 light 1/185・rush 1/328・lt 1/337。実測 初期 1.10/1.10/1.10・全強化 約1.2（60 seed）。30日 standard の閉店日・レート100バーストは変更前と同じ並び（再試算は未実施）
