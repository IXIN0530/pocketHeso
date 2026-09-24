# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P0 → `docs/plan/P0-bootstrap.md`
- Last done: P0-T3（ショートカット連携スパイク。Accept 全項目完了）
- Next: P0-T4（位置情報と Overpass のスパイク）— `?spike=geo` 実装済み、実機計測待ち
- Owner hint: Claude Code

## Blockers
- P0-T4 Accept は実機計測待ち（許可の再要求・屋内ジム/公園の accuracy・近所の施設件数）

## Notes（最新3件まで）
- P0-T3 実測: 時刻オートメーションは「実行中」通知のみで成否不明、かつ鮮度±30分で後から貼れない → 廃止（D-023）。
- P0-T3 実測: 本番版ショートカット完成。PWA へ往復し、sig 一致・3日分の days を確認。歩数はヘルスケアアプリの表示と3日とも一致（コード例は README 末尾、P4-T2 の fixture 用）。
- P0-T3 実測: iOS 26 のショートカットはワークアウトを読めない（種類に無し、アクションは開始/記録/終了のみ）→ D-022 で取得をやめ、README 1-3 を削除して 1-4 を繰り上げ。
