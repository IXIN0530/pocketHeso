# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P0 → `docs/plan/P0-bootstrap.md`
- Last done: P0-T2（PWA 化。iPhone でホーム画面追加・standalone 起動・機内モード起動を手動確認済み。main へ ff 済み）
- Next: P0-T3 の実機確認（実装・手順書はコミット済み）→ 結果記入後 P0-T4
- Owner hint: Claude Code

## Blockers
- P0-T3 Accept 残り1項目が実機待ち: ロック中オートメーション（README §2）。結果を platform-limits の実測列へ。

## Notes（最新3件まで）
- P0-T3 実測: 本番版ショートカット完成。PWA へ往復し、sig 一致・3日分の days を確認。歩数はヘルスケアアプリの表示と3日とも一致（コード例は README 末尾、P4-T2 の fixture 用）。
- P0-T3 実測: iOS 26 のショートカットはワークアウトを読めない（種類に無し、アクションは開始/記録/終了のみ）→ D-022 で取得をやめ、README 1-3 を削除して 1-4 を繰り上げ。
- P0-T3 実測: 起動・復帰検知・手動ペーストは OK。他アプリ由来のクリップボードは API 読み取りが不安定（platform-limits に記入）。
