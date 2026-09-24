# P0 Bootstrap & Spikes
目的: ビルドが通る骨組みを作り、**実機で OS 制約を実測** してから本実装に入る。
P0 のスパイクコードは `App/Sources/Spikes/` に隔離し、P0 完了時に `#if DEBUG` 化する。

### P0-T1 プロジェクト生成
Owner: Claude Code | Read: spec/10-architecture, ref/tooling, ref/conventions
Do:
- `project.yml`（3ターゲット、ローカル SPM 3パッケージ、settings に BUNDLE_PREFIX / DEVELOPMENT_TEAM / APP_GROUP）
- 3パッケージの `Package.swift`（Core は `.macOS(.v15), .iOS(.v26)`、`pachisim` executable、Tests）
- 各ターゲットの最小エントリポイント、Info.plist 値は project.yml 内で定義
- `scripts/gen.sh build.sh test.sh sim.sh install.sh`（出力は末尾40行＋`logs/` 保存）
Accept:
- [ ] `scripts/gen.sh && scripts/build.sh sim` 成功
- [ ] `scripts/test.sh core` 成功（ダミーテスト1件）

### P0-T2 署名・App Group・実機起動
Owner: Claude Code | Read: ref/tooling
Do: entitlements（App Groups 全ターゲット、Background Modes audio/fetch）、Motion/AlarmKit の usage 文言。
App と Widgets 拡張で App Group の同一ファイルを読み書きする確認画面。
Accept:
- [ ] 16e に `scripts/install.sh` で入り起動する
- [ ] 拡張（systemSmall ウィジェット）に App 側で書いた文字列が表示される

### P0-T3 スパイク: Live Activity 反映間隔
Owner: Claude Code | Read: spec/40-surface-live-activity, ref/platform-limits
Do: カウンタを 1秒毎に `update` する Activity。App Group に送信時刻ログ、ビューに表示値と `Date()` を出す。
ロックして10分放置 → 画面録画で実反映間隔を測る。`AlertConfiguration` 付き更新のバナー表示も確認。
Accept:
- [ ] platform-limits.md の「描画反映間隔」実測列を記入
- [ ] DI 非搭載機でのバナー表示の有無を記入

### P0-T4 スパイク: 無音オーディオ常駐
Owner: Claude Code | Read: spec/30-runtime（KeepAlive 節のみ）
Do: KeepAlive 最小実装 + 10秒毎ハートビートを App Group に追記。ロック60分、音楽アプリ再生、電話着信（可能なら）。
Accept:
- [ ] ハートビートの欠落区間を記録（STATUS Notes）
- [ ] 60分の電池減少量を記録

### P0-T5 スパイク: AlarmKit と通知コンテンツ拡張
Owner: Claude Code | Read: spec/42-surface-hot-events, ref/platform-limits
Do: 60秒 countdown アラーム（追加ボタンでアプリ起動）。通知コンテンツ拡張で SKView に回転ノードを表示。
Accept:
- [ ] サイレント中にアラームが鳴ることを確認
- [ ] 通知拡張で SpriteKit が動く。そのときのメモリ使用量を platform-limits に記入
- [ ] 失敗・想定外があれば DECISIONS に記録し、影響する spec に1行注記
