# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P9（v1.1: ラウンド5倍速・実績・レート表示）→ `docs/plan/P9-update-1-1.md`。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P9-T3 実績 Core（44個・生産 +1%/個・閉店で保持・IdleEconomy v6・web snapshot v5, D-098）。テストのみで実機項目なし
- Next: P9-T4（実績の画面）→ T5。v1.0.0 本番の4項目確認は引き続き人間待ち
- Owner hint: Claude Code（P9-T4・T5）／人間（本番の4項目確認・P9 の実機確認）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- P9-T1 の実機確認待ち（RUSH 中の 10R が約50秒・液晶の獲得出玉が 1R 約4秒で10個ぶん・各Rの効果音）
- P9-T2 の実機確認待ち（Debug でメダル→100パチまで全解放し7項目が1行に収まる。2・3項目でも崩れない）
- 本番確認の人間OK待ち（P8-T6 の Accept: Debugタブ無し・計測ログ無し/v1.0.0/初回案内・ホーム画面+ショートカット・セーブ引継ぎ）
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P9-T3]: 判定は economyTick 直後・一覧順・達成は次 tick から。24h advance の性能は指標ごとの最小しきい値の先読みと basePerSec キャッシュで T3 前と同程度（約90ms）。手計算系の旧テスト3本は実績一覧を空にして実行。v4/v5 の feverMs 読み捨てバグも修正。golden 23162bb518355b7f
- [P9-T2]: Segmented に `dense`（min-width 0・左右5px）を追加しレートだけで使用。見出し「レート（パチ）」付きの `.rate` を `flex-basis:100%` で打つボタンの下の行に。1発のコストは下の `.state` 行のみ。build・test all 通過
- [P9-T1]: sim run は3機種とも T1 前と同一。econ 打ち方 1・2 不変 OK、3 は悪化（light 6.42→8.01分・rush 6.37→6.89・lt 6.37→6.79、初当たり率不変）、EV は ±0.02 の揺れ。機種値は変えず。詳細 `docs/state/econ-20260930.md`
