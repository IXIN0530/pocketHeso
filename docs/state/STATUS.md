# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P10（常連ツリー: 常連Pの使い道・数ヶ月遊べる設計）→ `docs/plan/P10-prestige-tree.md`。最優先。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P10-T3（ツリーの効果を IdleEconomy に: treeMult・常連係数・実績・連続・値下げ・keep/starter/開店ダッシュ・燃料系・覚醒・即時報酬・予告の設定。golden 不変）
- Next: P10-T4（Engine: Action・予告の自動受け取り・特別保留・番頭さん・Projection・web の保存版）
- Owner hint: Claude Code（Opus。Split あり: web の SNAPSHOT_VERSION・型・旧セーブのテスト・spec/22 は Sonnet）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P10-T3]: T4 への申し送り: Engine の予告設定は構築・復元時のキャッシュなので treeBuy 後に読み直す。機種 id は `setMachineId` で経済に渡す（未接続）。Engine は予告間隔に intervalMult・Grant の即時の玉に `getProdMinMult` を掛けるよう変更済み。テストは tree-effects.test.ts 19件（Sonnet）
- [P10-T2]: 消えた id は記録から除いて返金（spec の「残す」だと再復元で二重返金になるため, D-104）。golden の差は新しい保存項目だけ（除くと旧ハッシュと一致を確認）。テストは tree-state.test.ts 10件（Sonnet）。web の SNAPSHOT_VERSION は T4
- [P10-T1]: spec/25 の未決事項は推奨のまま進行（人間の返事待ちではない）。検証に足したもの: 開かない段（下の段の数が tier_unlock に届かない）もエラー。機種名の照合は `treeUnknownMachines`（警告用）。economy-state.test の手計算用 JSON は medal_base・closed を変えるので tree を外した
