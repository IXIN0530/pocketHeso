# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P13（v1.4 抽選カスタム・先バレ・役物の強化 → `docs/plan/P13-feedback-1-3.md`）。P11-T6 の本番確認は Blockers。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P13-T5（色付き保留の変動に最短 6600ms。RUSH の変化保留が通常時と同じ尺で割れる）
- Next: P13-T6（Core: 覚醒 v2・共鳴・ツリーの新しい効果。Split: Opus Core / Sonnet pachisim）
- Owner hint: Claude Code（Opus）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- v1.2.1 の本番確認が人間待ち（Debug が無い・バージョン v1.2.1・短い留守でサマリーが出ない・オート打ちの設定が崩れない）
- v1.2.0 の本番確認が人間待ち（Debug が無い・バージョン v1.2.0・既存セーブで常連P・ツリーで開けて閉店後も残る）
- **P10-T5 検証 5・6 の 2 週が NG（人間判断、T6 以降は進めてよい。P12-T2 の測り直しでも同値: `--tree all` は休業の影響を受けない）**: 開店ダッシュを割り戻すと 12週中10週は 3.7〜5.4 だが、lt r74 3週目 6.08（基準 ≤5.5）・rush r180 4週目 7.00（≤6.0）。役物 Lv の段差による一時的な週。A そのまま（推奨）/ B densetsu・meiten の prod_add を下げて再試算。詳細 `docs/state/econ-20261013-p10.md`・D-105
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P13-T5]: 白以外の保留の変動は `max(短縮後, spin_min_colored_ms 6600)`（D-112, golden 6431733289044344）。EV 初期6桁一致・標準7日の表は3機種とも不変・RUSH 1回 +1%（`econ-20261021-p13.md`）。行動 56〜63% の基準外は変更前から（既存の持ち越し）。`test.sh all` は core の性能テストが負荷で揺れる（HEAD でも再現、単体・他パッケージは全て通る）。実機確認は T9
- [P13-T4]: `stores/lcd-view.ts`（盤面が変わった時だけ set）。状態行（大当たり中・連・モード・大当たり回数）と持ち玉は液晶基準、プレビュー・倍速・背面は Projection。持ち玉は未表示の大当たり出玉を引く。実績トーストは液晶が大当たりを映すまで保留。モードの残り回数は液晶と Projection のモードが違う間は出さない。実機確認は T9
