# P7 Soak & Tune

### P7-T1 ローカル計測ログ
Owner: Claude Code | Read: spec/30-runtime
Do: tick 間隔、KeepAlive の停止/復帰、LA 送信、ウィジェットリロード、電池残量を `logs/metrics.jsonl` に。
DebugView でグラフ表示（Swift Charts）。

### P7-T2 24時間実運用
Owner: 人間 + Claude Code（ログ解析）
Accept:
- [ ] 24h の電池消費、KeepAlive 欠落、LA 途切れ、通知/アラーム発火数をレポート化（`docs/state/soak-YYYYMMDD.md`, 40行以内）

### P7-T3 バランス調整
Owner: Muse Spark | Read: spec/21-core-lottery, spec/20-core-physics（目標値節）
Do: 体感を踏まえて盤面・機種 JSON を調整 → Atlas 再生成 → pachisim で理論値確認 → ゴールデン更新（DECISIONS に記録）。

### P7-T4 省電力モード
Owner: Claude Code | Read: spec/30-runtime（KeepAlive 節）
Accept:
- [ ] `off` / `chargingOnly` でも CatchUp により結果が同一であることを実機で確認
