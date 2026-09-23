# P6 Hot Events: 演出・通知拡張・AlarmKit
配線（T1, T3, T4）は Claude Code、演出シーン（T2）は Muse Spark。T2 は T1 と並行可。

### P6-T1 熱さ判定と予約マネージャ
Owner: Claude Code | Read: spec/42-surface-hot-events（熱さレベル・予約節）
Do: `HotScheduler`: lookahead → 山場時刻 → 通知/アラーム予約、ずれたら取消・再予約、設定の閾値。
Accept:
- [ ] DebugView の歩数注入で予約→取消→再予約がログに出る

### P6-T2 PachinkoPresentation 演出シーン
Owner: Muse Spark | Read: spec/42-surface-hot-events（PachinkoPresentation 節）, spec/21-core-lottery（変動パターン節）
Do: `PresentationScene(pattern:result:seed:)`。通常リーチ / SP / 激アツ（疑似連・群）/ 確定 の4本。
図形・テキスト・パーティクルのみ。尺はパターンの `ms` に一致。
Accept:
- [ ] 同じ入力で同じ演出分岐（乱数ログ比較テスト）
- [ ] テクスチャ合計 20MB 以内

### P6-T3 通知コンテンツ拡張
Owner: Claude Code | Read: spec/42-surface-hot-events（通知ペイロード・拡張節）
Accept:
- [ ] ロック画面で通知を長押し → 演出再生 → 結果表示 →「アプリで見る」で遷移
- [ ] 実機でメモリ上限に当たらない（Xcode のメモリゲージ）

### P6-T4 AlarmKit
Owner: Claude Code | Read: spec/42-surface-hot-events, ref/platform-limits（AlarmKit 節）
Do: オプトイン UI（既定 OFF）、countdown 予約、Live Activity 表示、「見る」ボタン→アプリの演出再生。
Accept:
- [ ] サイレント中に確定演出の予告が鳴り、ボタンで演出が再生される

### P6-T5 アプリ内演出プレイヤー
Owner: Muse Spark | Read: spec/50-app-rendering（画面節）
Accept:
- [ ] 通知・アラーム・盤面の液晶エリアから同一シーンが再生される
