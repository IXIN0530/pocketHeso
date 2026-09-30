# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P9（v1.1: ラウンド5倍速・実績・レート表示）→ `docs/plan/P9-update-1-1.md`。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P9-T1 ラウンド5倍速（3機種 ms_per_round 5000・HUD 既定 5000・golden a009ee1ba27c3791, D-097）。dev push 済み・実機確認待ち
- Next: P9-T2（レート表示）→ T3（実績 Core）→ T4 → T5。v1.0.0 本番の4項目確認は引き続き人間待ち
- Owner hint: Claude Code（P9-T1〜T5）／人間（本番の4項目確認・P9 の実機確認）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- P9-T1 の実機確認待ち（RUSH 中の 10R が約50秒・液晶の獲得出玉が 1R 約4秒で10個ぶん・各Rの効果音）
- 本番確認の人間OK待ち（P8-T6 の Accept: Debugタブ無し・計測ログ無し/v1.0.0/初回案内・ホーム画面+ショートカット・セーブ引継ぎ）
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P9-T1]: sim run は3機種とも T1 前と同一。econ 打ち方 1・2 不変 OK、3 は悪化（light 6.42→8.01分・rush 6.37→6.89・lt 6.37→6.79、初当たり率不変）、EV は ±0.02 の揺れ。機種値は変えず。詳細 `docs/state/econ-20260930.md`
- [P9 計画]: 9/30 人間の要望3点を P9 に。実績の報酬は「生産 +1%/個・閉店で保持」、5倍速は「全ての大当たり」を人間が選択（D-094・D-095）。レート選択は数字だけのセグメントで1行（D-096）。dev で開発し T6 で v1.1.0
- [P8-T6 修正]: Vercel Production で web テスト1件失敗（clock.test が `__DEV_TOOLS__=true` 前提。VERCEL_ENV=production で false）→ 正式版は倍率1を期待するよう修正。VERCEL_ENV=production でも test 通過、build・test all 通過、dev push 済み。人間の指示で main に ff (bdf4f46)・push。v1.0.0 タグは bc86b75 のまま
