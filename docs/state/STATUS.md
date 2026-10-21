# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P13（v1.4 抽選カスタム・先バレ・役物の強化 → `docs/plan/P13-feedback-1-3.md`）。P11-T6 の本番確認は Blockers。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P13-T7（覚醒 v2 の値 Lv25・×3・共鳴 0.15、ツリーに台の癖・共鳴2つ・開店祝いを相対に。spec/23・25・DECISIONS D-114。人間の OK 待ち）
- Next: P13-T7 の人間 OK → P13-T8（web: 覚醒・新ノードの見せ方）
- Owner hint: 人間（T7 の OK）→ T8 は Claude Code（Sonnet）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- **P13-T7 の人間 OK 待ち**（`docs/state/econ-20261021-p13.md` の P13-T7 節）: 体感の目標は初覚醒 ×1.9・中央値 ×2.4 で OK。NG は ①保持の効き ×2 が測れない（bot は上位しか覚醒せず台の癖は 1.00 倍。台の記憶＝全保持は天井 56〜133倍で外した）②検証5 の4週目 rush 12.1・lt 13.5／検証6 9〜13（≤5.5/6.0。覚醒 v2 の段差）③lt 6週目の週最高が off の 0.99。A このまま（推奨）/ B mult か min_lv を上げ下げして再試算 / C 保持を「覚醒1つまで」などに作り直す（Core 変更）
- v1.2.1 の本番確認が人間待ち（Debug が無い・バージョン v1.2.1・短い留守でサマリーが出ない・オート打ちの設定が崩れない）
- v1.2.0 の本番確認が人間待ち（Debug が無い・バージョン v1.2.0・既存セーブで常連P・ツリーで開けて閉店後も残る）
- **P10-T5 検証 5・6 の 2 週が NG（人間判断、T6 以降は進めてよい。P12-T2 の測り直しでも同値: `--tree all` は休業の影響を受けない）**: 開店ダッシュを割り戻すと 12週中10週は 3.7〜5.4 だが、lt r74 3週目 6.08（基準 ≤5.5）・rush r180 4週目 7.00（≤6.0）。役物 Lv の段差による一時的な週。A そのまま（推奨）/ B densetsu・meiten の prod_add を下げて再試算。詳細 `docs/state/econ-20261013-p10.md`・D-105
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P13-T7]: 候補 18（min_lv 25/50 × mult 3/5/10 × r 0.1/0.15/0.25）は全て初覚醒 ≥1.5・中央 ≥1.3 → 最も控えめな l25・m3・r0.15（r は風車の2回目 ×1.1 の最小）。閉店日・gain・none・EV は不変、golden 不変、1閉店 P 10〜15・実績 +1。core のテストは仕組みのテストを旧の覚醒値に固定。web の tree-defs に新ノードの系統だけ追加（見せ方は T8）。Sonnet が試算と表、Opus が選定・spec
- [P13-T6]: `awaken.reset_lv`/`resonance`（既定 true/0 で従来と完全一致）・keep `awaken_low`/`awaken_all`・`starter_rel`・`resonance_add`・IdleEconomy v9（runMaxLv/prevMaxLv）・Shop の `awakenGain`（D-113, golden f9c91db2a7424498＝保存項目だけの変化）。変更前の覚醒は3機種とも初覚醒4日目・直後の比 x0.999（Lv を 0 に戻すので下がる）・84日で25回（`econ-20261021-p13.md`）。pachisim `--awaken-pick first|best`（既定 best）・`--awaken-log`。pachisim の閉店後の写し（lv/awakened を 0）は T7 で keep/starter_rel を入れる時に要確認。web の SNAPSHOT_VERSION は据え置き（v8 も読める）
- [P13-T5]: 白以外の保留の変動は `max(短縮後, spin_min_colored_ms 6600)`（D-112, golden 6431733289044344）。EV 初期6桁一致・標準7日の表は3機種とも不変・RUSH 1回 +1%（`econ-20261021-p13.md`）。行動 56〜63% の基準外は変更前から（既存の持ち越し）。`test.sh all` は core の性能テストが負荷で揺れる（HEAD でも再現、単体・他パッケージは全て通る）。実機確認は T9
