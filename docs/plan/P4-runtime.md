# P4 Runtime
T1・T2 は P2 と並行可能（Core の公開 API 型だけ先に合意しておく）。

### P4-T1 StateStore
Owner: Claude Code | Read: spec/10-architecture（状態の保存節）, spec/30-runtime
Do: App Group への原子的書き込み、スキーマ版数と移行、jsonl 追記、24h より古い events の切り詰め。
Accept:
- [ ] 書き込み途中クラッシュ（テストで rename 前に中断）でも前回状態が読める

### P4-T2 入力ソース
Owner: Claude Code | Read: spec/30-runtime
Do: `StepInputSource`（ライブ＋履歴）、`ThermalInputSource`、権限フロー。
Accept:
- [ ] 実機で歩いた歩数が ledger に入る。アプリ終了中に歩いた分も次回起動で入る

### P4-T3 RuntimeCoordinator と CatchUp
Owner: Claude Code | Read: spec/30-runtime, spec/22-core-events（Engine 節）
Do: 1Hz tick、保存間隔、前面化・起動・BG 時の CatchUp。P3 の開発用モードを Runtime 経由に切替。
Accept:
- [ ] 常駐ありで1時間 と 常駐なし→1時間後に起動 で、イベント列ハッシュが一致（実機）
- [ ] 8時間分の CatchUp 所要時間を STATUS Notes に記録

### P4-T4 KeepAlive 本実装
Owner: Claude Code | Read: spec/30-runtime（KeepAlive 節）, ref/platform-limits
Do: P0-T4 のスパイクを本実装化。割り込み・経路変更・メディアサービスリセット対応、設定3モード。
Accept:
- [ ] 音楽再生→停止、通話→終了 の後に自動復帰（ハートビートで確認）

### P4-T5 BGAppRefreshTask
Owner: Claude Code | Read: spec/30-runtime
Accept:
- [ ] `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"..."]` で CatchUp が走る
