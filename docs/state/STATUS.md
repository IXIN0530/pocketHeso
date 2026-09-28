# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P8 → `docs/plan/P8-release.md`（公開優先, D-089）
- Last done: P8-T8（レートを生産連動に。unit=rate×ref×8・ボーナス廃止・golden 5a70c4f721dd8dcc）
- Next: P8-T9（期待値とバランス目標）→ T6（人間の指示で）
- Owner hint: Claude Code（T9。Core を触るので決定論・golden に注意）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は P8-T6 の後、人間の指示で再開

## Blockers
- README手順の人間確認待ち（P8-T5 の Accept。フォーク→Vercel で抜けが無いか読んで確認）
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- **バランス（P7-T10, 人間の判断待ち）**: 行動の即時が週「生産48時間ぶん」で役物（約8時間ぶん）より大きい・初閉店 day5。大当たりの内訳目標と全強化EV（1.08〜1.23）は P8-T8/T9（D-090）で置き換え・修正する。詳細は `docs/state/econ-20260928.md`

## Notes（最新3件まで）
- [P8-T8 レビュー修正]: 旧 v3 スナップショットを読み Core restore でレート移行・打つレートも丸め・オート蓄積は1発分で頭打ち・Engine 経路のテスト4本追加（D-092）。golden 不変。test core・build・test all 通過、dev push 済み。既に v4 で保存し直した端末には効かない
- [P8-T8]: 単価 unit=rate×ref×8・ボーナス廃止・レート1/2/4/10/20/40/100・旧400/1000→100移行・オートは生産×share/unit・webに1発◯玉表示。test core・build・test all通過、dev push済み。**実機待ち（人間）**: 1パチ1分で生産約13分減・当たりで数時間増。担当はClaude Code推奨だがMuse Sparkが実行
- [P8-T5]: README を遊ぶ人向け/開発者向けの2部に（本番URLはT6で記入・iCloudリンクはT3で記入）。LICENSE（MIT）・package.json license・AboutSheetの表記もMITに。素材は合成音＋Canvas生成＋自作仮アイコン（images/は公開外）。build・test all通過。**Accept残: 人間がREADMEを読んで手順の抜け確認**
(End of file - total 18 lines)
