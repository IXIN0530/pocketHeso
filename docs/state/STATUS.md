# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P9（v1.1: ラウンド5倍速・実績・レート表示）→ `docs/plan/P9-update-1-1.md`。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P9-T5 実績込みの試算（初閉店は実績なしと同じ 5日目・行動なしは閉店せず・heavy OK。`econ` に達成数/achMult 列。結果 `docs/state/econ-20260930-p9t5.md`）
- Next: P9-T6（v1.1.0 リリース。**人間の「リリースしてよい」の指示があるまで着手しない**）。v1.0.0 本番の4項目確認は引き続き人間待ち
- Owner hint: 人間（P9-T1〜T4 の実機確認・リリース可否）→ Claude Code（P9-T6）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- P9-T1 の実機確認待ち（RUSH 中の 10R が約50秒・液晶の獲得出玉が 1R 約4秒で10個ぶん・各Rの効果音）
- P9-T2 の実機確認待ち（Debug でメダル→100パチまで全解放し7項目が1行に収まる。2・3項目でも崩れない）
- 本番確認の人間OK待ち（P8-T6 の Accept: Debugタブ無し・計測ログ無し/v1.0.0/初回案内・ホーム画面+ショートカット・セーブ引継ぎ）
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- P9-T4 の実機確認待ち（既存セーブで開くと実績がまとめて達成されトーストが1つ・記録タブの一覧と進捗が横にはみ出さない・閉店後も実績と生産 +n% が残る）
- P9-T5 の人間判断待ち（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P9-T5]: 閉店日は実績の有無で全一致（5,10,15,19,25…）。none は 61日で 8個 ×1.08。12w 伸びは離散的な最高 perSec の取り方に左右される指標（light/rush は実績込みで上がった）。基準は `--economy` に mult_per 0 の JSON
- [P9-T4]: 名前は `engine/achievement-defs.ts` が JSON の achievements だけを読む（parseEconomy をメインのチャンクに入れない。+3kB。一致はテストで確認）。起動の追いつき中の achieved も BootResult.events で画面へ渡しトーストに。トーストは前進ごとに1つ、盤面上部（リプレイ札の下）
- [P9-T3]: 判定は economyTick 直後・一覧順・達成は次 tick から。24h advance の性能は指標ごとの最小しきい値の先読みと basePerSec キャッシュで T3 前と同程度（約90ms）。手計算系の旧テスト3本は実績一覧を空にして実行。v4/v5 の feverMs 読み捨てバグも修正。golden 23162bb518355b7f
