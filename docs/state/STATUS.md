# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P13（v1.4 抽選カスタム・先バレ・役物の強化 → `docs/plan/P13-feedback-1-3.md`）。P11-T6 の本番確認は Blockers。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P13-T2（先バレの時刻は合っていた。まとめて足された先バレの音を1回に）
- Next: P13-T3（先バレの音を 先バレ音.mp3 に）
- Owner hint: Claude Code（Sonnet）
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
- [P13-T2]: 時刻はテストで確認（`sakibare-timing.test.ts`: 通常=ヘソと同時刻+150ms・満タンでは鳴らない・RUSH=最後尾・済みは再度鳴らない・RUSH 5時間で resyncs 0）。直したのは同時刻の音の重なりだけ（D-111）。`scripts/test.sh all` は core の性能テスト（p3t3, 150ms）が並列実行の負荷で落ちる（変更前の HEAD でも再現。単体は全パッケージ通る）
- [P13-T1]: fx の先バレ抽選（式・統計テスト・spec/43・D-110）は Opus、prefs・設定・lcd-timeline の接続は Sonnet（worker）。取得時のモードは Core の `modeAtDraw`。Core 無変更。人間 10/20: 覚醒の「共鳴」と T5 の変動時間を延ばす案は OK
- [P13 計画]: 先バレ音.mp3 は ~/Downloads にあったので `apps/web/public/sounds/先バレ音.mp3` へコピー（未コミット・T3 で改名して追加）。T7 は人間の OK で止まる
