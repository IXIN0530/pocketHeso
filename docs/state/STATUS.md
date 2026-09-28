# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P8 → `docs/plan/P8-release.md`（公開優先, D-089）
- Last done: 公開優先への切り替え（P7-T11〜T13・P7-T2 を保留、P8-T3 は階数なしで進める, D-089）
- Next: P8-T3（人間: iPhone でショートカットを README 2-1 に直し iCloud リンクを作る → エージェントが記入）→ T6（人間の指示で）
- Owner hint: 人間＋Muse Spark（T3）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は P8-T6 の後、人間の指示で再開

## Blockers
- README手順の人間確認待ち（P8-T5 の Accept。フォーク→Vercel で抜けが無いか読んで確認）
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- **バランス（P7-T10, 人間の判断待ち）**: 標準1〜7日の内訳 大当たり/行動 = light 12/66%・rush 24/58%・lt 47/39%（目標 各25〜45%）。原因は行動の即時が週「生産48時間ぶん」に対し燃料が週13.3時間で役物が約8時間ぶんしか回らないこと。初閉店 day5（メダル28枚/Pで決まる）、全強化EV 1.08〜1.23（D-079 の自動補充）も NG。値は変えていない。詳細と選択肢は `docs/state/econ-20260928.md`

## Notes（最新3件まで）
- [P8-T5]: README を遊ぶ人向け/開発者向けの2部に（本番URLはT6で記入・iCloudリンクはT3で記入）。LICENSE（MIT）・package.json license・AboutSheetの表記もMITに。素材は合成音＋Canvas生成＋自作仮アイコン（images/は公開外）。build・test all通過。**Accept残: 人間がREADMEを読んで手順の抜け確認**
- [P8-T4]: 初回起動で3枚の案内シート（何のゲームか／ホーム画面に追加（ブラウザのみ）／受け取り方、スキップ可）。新規のみ・閉じたらonboardedAt保存・既存セーブでは出さない。設定のアプリに「はじめての案内をもう一度」と「このアプリについて」。test all・build・release-check通過、dev push済み。**実機OK（人間確認済み）**。ライセンス表記はP8-T5でMITに更新
- [P8-T2]: 鍵を `shortcuts://…&input=text&text=<鍵>` で渡す（SHORTCUT_ICLOUD_URLはT3まで空文字）。開始ボタン廃止→初回受け取りで鍵自動生成・初成功でshortcutReadyAt保存。準備3手順/毎回2ボタン＋やり直し、鍵と手貼りは詳細へ。エラー文言に次の一手。README 1-1/2-1/2-4/2-5改訂（共有シートの再確認はT3で）。test all・build・release-check通過、dev push済み。**実機はT3でまとめて確認**。
(End of file - total 18 lines)
