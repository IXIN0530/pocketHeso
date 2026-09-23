# P5 Surfaces: Live Activity & Lock Screen Widgets
前提: P4-T3 完了。拡張は Engine を回さず App Group のファイルを読むだけ。

### P5-T1 共有型
Owner: Claude Code | Read: spec/40-surface-live-activity（Attributes 節）, spec/22-core-events（Projection 節）
Do: `HesoActivityAttributes`（PachinkoShared）、Projection を ContentState に流用。
Accept:
- [ ] 最大状態の ContentState エンコード長を単体テストで検証（≤ 1KB）

### P5-T2 Live Activity ビュー
Owner: Claude Code | Read: spec/40-surface-live-activity
Do: ロック画面ビュー（主）、DI ビュー（最小）、打ち出し ON/OFF の App Intent ボタン。
Accept:
- [ ] Xcode Preview で5状態（通常/保留満タン/変動中/大当たり/ST）を確認（MCP の RenderPreview 可）
- [ ] 実機ロック画面・通知センターで表示

### P5-T3 更新スケジューラとローテーション
Owner: Claude Code | Read: spec/40-surface-live-activity（更新スケジューラ節）, ref/platform-limits
Do: minInterval 合流、即時イベント、AlertConfiguration の条件と時間上限、staleDate、7h45m ローテーション。
全送信を App Group の `logs/la.jsonl` に記録。
Accept:
- [ ] 実機で8時間超の連続稼働中に Activity が途切れない
- [ ] 送信ログと画面録画で、minInterval 未満の送信が無いことを確認

### P5-T4 ロック画面ウィジェット
Owner: Claude Code | Read: spec/41-surface-widgets
Do: 3 kind、60エントリタイムライン、リロード方針と予算カウンタ、単色描画時の記号区別。
Accept:
- [ ] 1分毎に保留表示が変わる（リロードなしで）ことを実機で確認
- [ ] 1日のリロード回数が予算内（ログ）
