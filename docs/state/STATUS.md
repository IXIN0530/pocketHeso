# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P4 → `docs/plan/P4-activity.md`
- Last done: [P4-T2] ショートカットのコード（parseShortcutCode, D-056）※実機 fixture 2件待ち
- Next: P4-T2 の fixture 追加（人間から受け取ったら）→ P4-T3 チェックイン判定
- Owner hint: Claude Code

## Blockers
- P4-T2 Accept「実機由来 fixture 3件以上」: 手元は1件（2026-09-24）。人間が試験用鍵でショートカットを2回（別の日・時刻）実行したコードが要る。件数テストは3件未満の間 todo 表示
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P4-T2 (D-056): claims に parseShortcutCode・同期 SHA-256（node:crypto と一致テスト）・ClaimError（format/version/signature/stale）。実機コード1件＋変種で3種のエラーが別になること・範囲外の破棄と警告・空値/改行/数字文字列の吸収をテスト。spike 画面に検証欄（鍵入力つき）。resources/shortcut/README.md を利用者向け（初回・毎回・エラー表）＋作者向け（読み込み時の質問・iCloud リンク作成）に再構成。iCloud リンクは未作成。core/build/all 通過。
- P4-T1 (D-055): claims に ClaimRecord/ClaimRules(parseClaimRules)/planGrants/streakOf と日付算術（Date 不使用）。default.json の claims 節に換算・逓減・trust・streak 閾値を追加（Core 未使用なので golden 不変）。休養日パスは rest 記録（燃料0・streakDay 付き）で Engine の連日数と一致をテストで確認。3000→8000→8000→7000 は 30分＋50分のみ。core/build/all 通過。実機確認不要。pachisim econ は独自の換算（stepsFuelMin 等）のままなので、将来 claims に寄せる余地あり。
- P3-T6 レビュー修正 (D-054): sim のフィーバー内訳を区間内フィーバー tick 数で按分・週次役物を (最上位, Lv合計) 辞書順で判定・heavy は同条件 standard と常連P自動比較・lt EV下限0.7 の根拠を D-054/spec23 に記載・econ.test に按分/閉店履歴/玉内訳/判定行のテスト。正しい按分で rush seed3 が19.4%のため rate1 フィーバー 4→4.5（golden 3f67ce0cf12b88a7）。27条件全OK（標準フィーバー22.9〜35.2%・週次Lv合計は全seedで単調増・heavy 6P>standard 5P、12週 heavy18P>standard15P で D-053 と同じ）・core/build/all通過。実機確認不要。
