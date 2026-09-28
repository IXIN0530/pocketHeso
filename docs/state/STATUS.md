# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P8 → `docs/plan/P8-release.md`（公開優先, D-089）
- Last done: P8-T9（打ち方--play-rate/--play-minと1-3出力・spec/23を1-3に・機種値は変更なし・D-093）
- Next: P8-T6（人間の「リリースしてよい」指示待ち。Blockers解決か「このまま出す」明言が前提）
- Owner hint: Muse Spark（T6。リリース作業）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は P8-T6 の後、人間の指示で再開

## Blockers
- README手順の人間確認待ち（P8-T5 の Accept。フォーク→Vercel で抜けが無いか読んで確認）
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- **バランス（P8-T9, 人間の判断待ち）**: 1 OK・2 OK（3機種）・3 NG（6.4分 vs 2-5分）・EV初期 NG（1.04-1.13 vs 0.93-0.96）・EV全強化 NG（1.11-1.17 vs ≤1.00）。2と3・EVは出玉に対して逆要求でlightの余裕がなく両立しない。詳細は `docs/state/econ-20260929.md`
- **バランス（P7-T10, 人間の判断待ち）**: 行動の即時が週「生産48時間ぶん」で役物（約8時間ぶん）より大きい・初閉店 day5。行動内訳は spec/23 のまま。詳細は `docs/state/econ-20260928.md`

## Notes（最新3件まで）
- [P8-T9]: `--play-rate/--play-min`（19時追加・解放仮定）と1-3出力（理論時間・バースト100試行上限30分）・spec/23を1-3とEV新目標に・結果表 econ-20260929。1・2 OK、3・EV NGで機種値は変えず止める。test core・build・test all通過。担当はClaude Code推奨だがMuse Sparkが実行
- [P8-T8 レビュー修正]: 旧 v3 スナップショットを読み Core restore でレート移行・打つレートも丸め・オート蓄積は1発分で頭打ち・Engine 経路のテスト4本追加（D-092）。golden 不変。test core・build・test all 通過、dev push 済み。既に v4 で保存し直した端末には効かない
- [P8-T8]: 単価 unit=rate×ref×8・ボーナス廃止・レート1/2/4/10/20/40/100・旧400/1000→100移行・オートは生産×share/unit・webに1発◯玉表示。test core・build・test all通過、dev push済み。**実機待ち（人間）**: 1パチ1分で生産約13分減・当たりで数時間増。担当はClaude Code推奨だがMuse Sparkが実行
(End of file - total 18 lines)
