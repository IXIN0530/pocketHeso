# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P15 → `docs/plan/P15-upper-rush.md`（国道店の上位RUSH・上乗せ）。v1.5.0 の本番確認が人間待ち。P8-T7（任意）と P7 再開は人間の指示待ち
- Parallel: なし（P13-T9・P14-T4 の実機は人間 OK 済み。P13-T10 は v1.5.0 に統合）
- Last done: P15-T2（試算: rush EV 1.126 で light・lt と ±0.03 内・上乗せ分布 OK、台のスペック画面に上位RUSH）
- Next: P15-T3（fx: 上位・上乗せの見せ方の計画と液晶の時刻表）
- Owner hint: Claude Code（Opus。Split: spec/43 の節は Sonnet）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T2 は人間の指示で再開（T12 遠征は取り下げ D-118、T13 は P14 に置き換え）

## Blockers
- v1.5.0 の本番確認が人間待ち（Debug が無い・バージョン v1.5.0・既存セーブで開ける・最初の台は駅前店・ツリーで店を開けて休業中に台を選べる・台のスペック・抽選カスタムと先バレ音）
- v1.2.1 の本番確認が人間待ち（Debug が無い・バージョン v1.2.1・短い留守でサマリーが出ない・オート打ちの設定が崩れない）
- v1.2.0 の本番確認が人間待ち（Debug が無い・バージョン v1.2.0・既存セーブで常連P・ツリーで開けて閉店後も残る）
- **P10-T5 検証 5・6 の 2 週が NG（人間判断済み: A そのまま, D-115、T6 以降は進めてよい。P12-T2 の測り直しでも同値: `--tree all` は休業の影響を受けない）**: 開店ダッシュを割り戻すと 12週中10週は 3.7〜5.4 だが、lt r74 3週目 6.08（基準 ≤5.5）・rush r180 4週目 7.00（≤6.0）。役物 Lv の段差による一時的な週。A そのまま（推奨）/ B densetsu・meiten の prod_add を下げて再試算。詳細 `docs/state/econ-20261013-p10.md`・D-105
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P15-T2]: `docs/state/econ-20261022-p15.md`。pachisim の `sim run` は上位を E[K] で数え（理論 10.63）、実測に上位の割合・K の分布・最大出玉の行。EV 60 seed（1000h）: rush 1.126 / light 1.101 / lt 1.100（前の rush 1.096、差は seed のぶれ内）→ 66回のまま。週の伸び（検証5・6）の4週目 12〜13.6 は P13 の覚醒 v2 からの持ち越し（econ-20261021-p13 と同値、P15 の前後で同程度）。スペック画面: 上位の扇は別色・「20R＋上乗せ 約3,000〜9,000個」、表に上位RUSH・上乗せ・RUSH 中の当たりの平均 約2,000個、フローに注記。全部 Opus
- [P15-T1]: 上位の枝は `bonusRounds` に K 込みの上乗せ合計（jackpotStarted・snapshot とも）、`JackpotView.rounds` も合計で upper・loops を付ける（白黒中に 10R→20R と見せるのは fx, T3）。`jackpotPayoutBalls/TotalRounds/BonusRounds/jackpotDurationMs` に任意の `loops`。golden 不変。**web の `machine-spec-view.test.ts`（国道店）が 66回・上位の扇で落ちたまま = T2 で表示ごと直す**。新テスト1本で core 全体実行時に p3t3 の時間計測（150ms）が競合で落ちやすくなったため、測り直しを 5→10 回に（基準は不変。単独では変更前後とも約105ms）
- [P14-T3]: `engine/machine-spec-view.ts`（Opus）: 割合は最大剰余で合計100、継続率 = 1−(1−1/n)^回転数 × RUSH に戻る枝の割合（light は ST 中も 50% が通常行きなので RUSH 継続率 46.0%・rush 85.1%・lt 突入44.3%/引き戻し25.7%/RUSH 75.9%/LT 90.1%）。出玉は「1発 1玉のとき」と注記（ボーナスは D-080 で廃止済み）。画面（Sonnet）: 扇には % だけ、R数・出玉・次の状態は凡例（375px で文字が入らないため）。アプリは暗い配色のみなのでライト/ダーク切替はなし。core の p3t3 の時間計測（150ms）が全体実行で1回落ち再実行で通過
