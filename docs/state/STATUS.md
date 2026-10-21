# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P14（v1.5 店の開放を常連ツリーに・休業中の台選び・台のスペック → `docs/plan/P14-shops-spec.md`）。P11-T6 の本番確認は Blockers。P8-T7（任意）と P7 再開は人間の指示待ち
- Parallel: P13（`docs/plan/P13-feedback-1-3.md`）→ Next: P13-T9（実機・人間。手順は T8c の報告で渡した）→ T10 は人間の「リリースしてよい」待ち
- Last done: P14-T2（web: 3台を Engine に渡す・休業のシートに「次に打つ台」・ホールに店名と開店の店名表示。表示は Projection.machineId）
- Next: P14-T3（台のスペック画面。Split: Opus=machineSpecView と円グラフ用データ・テスト / Sonnet=画面・導線）→ T4（実機）→ T5 は人間の指示時
- Owner hint: Claude Code（T3 は Split: Opus → Sonnet）。P13-T9 は人間
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T2 は人間の指示で再開（T12 遠征は取り下げ D-118、T13 は P14 に置き換え）

## Blockers
- v1.2.1 の本番確認が人間待ち（Debug が無い・バージョン v1.2.1・短い留守でサマリーが出ない・オート打ちの設定が崩れない）
- v1.2.0 の本番確認が人間待ち（Debug が無い・バージョン v1.2.0・既存セーブで常連P・ツリーで開けて閉店後も残る）
- **P10-T5 検証 5・6 の 2 週が NG（人間判断済み: A そのまま, D-115、T6 以降は進めてよい。P12-T2 の測り直しでも同値: `--tree all` は休業の影響を受けない）**: 開店ダッシュを割り戻すと 12週中10週は 3.7〜5.4 だが、lt r74 3週目 6.08（基準 ≤5.5）・rush r180 4週目 7.00（≤6.0）。役物 Lv の段差による一時的な週。A そのまま（推奨）/ B densetsu・meiten の prod_add を下げて再試算。詳細 `docs/state/econ-20261013-p10.md`・D-105
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P14-T2]: 閉店履歴の「周回ごとの台」は CloseRecord に machineId が無く出せないため、記録には「いまの台」だけ（周回ごとにするなら Core に machineId を足す＝golden/snapshot に影響。要判断）。自動開店でもホールの店名表示は台が変わった時に出る。pickMachine の押下は実機（T4）で確認。全部 Sonnet
- [P14-T1]: Engine に `machines`・`pickMachine`、Projection に `machineId`・`restMachineId`・`machinesOpen`、`opened.machineId`。切り替えは保留・変動中・電サポ／大当たりを捨て normal から（RUSH 中なら `modeChanged` normal を `opened` の直後）。`--tree greedy`（standard 84日・3機種）は閉店日・判定が不変、新ノードを3〜4週目に買うぶん4週目の最高到達役物が light 837→818 等わずかに下がる（D-119）。web は `tree-defs.ts` の系統に2行足しただけ（表示は T2）。全部 Opus
- [P13-T8c]: 通常・時短は T8b と同値。ST・LT の sb40 は白の当たり 87%・白のハズレ 0.6%、sb90 は白の当たり 75% に先バレ（表 `docs/state/sakibare-occ-20261021.md`）。sb90 の白の先バレは全部金で見せる（金の信頼度 95→98%、RUSH で金が約3倍出る）。見た目の熱さと Core の熱さ（白）が合わない保留あり。`tree-engine.test.ts` の時間比較が全体実行で1回不安定（今回は無関係・再実行で通過）。Opus が fx、Sonnet が web テスト・spec・DECISIONS
