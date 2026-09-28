# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P8 → `docs/plan/P8-release.md`（公開優先, D-089）
- Last done: P8-T3（iCloud リンク記入）／レート生産連動の計画（D-090, P8-T8・T9 を追加）
- Next: P8-T8（レートを生産連動に）→ P8-T9（期待値とバランス目標）→ T6（人間の指示で）
- Owner hint: Claude Code（T8・T9。Core を触るので決定論・golden に注意）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は P8-T6 の後、人間の指示で再開

## Blockers
- README手順の人間確認待ち（P8-T5 の Accept。フォーク→Vercel で抜けが無いか読んで確認）
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- **バランス（P7-T10, 人間の判断待ち）**: 行動の即時が週「生産48時間ぶん」で役物（約8時間ぶん）より大きい・初閉店 day5。大当たりの内訳目標と全強化EV（1.08〜1.23）は P8-T8/T9（D-090）で置き換え・修正する。詳細は `docs/state/econ-20260928.md`

## Notes（最新3件まで）
- [P8-T3]: iCloud リンク（…/b542799bc07940afb3ad1f09fb1219d5）を SHORTCUT_ICLOUD_URL・README 2か所に記入。**実機OK（人間）**: 2-1 に直して dev から受け取れる・リンクから追加し直して受け取れる・iOS 表記は README と一致。未報告: ショートカットアプリから直接実行して止まるか。build・test all 通過
- [P8-T5]: README を遊ぶ人向け/開発者向けの2部に（本番URLはT6で記入・iCloudリンクはT3で記入）。LICENSE（MIT）・package.json license・AboutSheetの表記もMITに。素材は合成音＋Canvas生成＋自作仮アイコン（images/は公開外）。build・test all通過。**Accept残: 人間がREADMEを読んで手順の抜け確認**
- [P8-T4]: 初回起動で3枚の案内シート（何のゲームか／ホーム画面に追加（ブラウザのみ）／受け取り方、スキップ可）。新規のみ・閉じたらonboardedAt保存・既存セーブでは出さない。設定のアプリに「はじめての案内をもう一度」と「このアプリについて」。test all・build・release-check通過、dev push済み。**実機OK（人間確認済み）**。ライセンス表記はP8-T5でMITに更新
(End of file - total 18 lines)
