# 41 PWA Platform（配布・保存・OS 連携）
制限値の出典と実測は ref/platform-limits.md。

## 配布
- Vercel（Hobby, D-021）。GitHub 連携で `main` への push が本番、`dev` などへの push がプレビュー（URL は push ごとに発行）。
  ルート `/` で配信するので Vite の `base` は既定のまま。設定はリポジトリ直下の `vercel.json`。
- プレビューと本番はオリジンが違う → 保存領域（IndexedDB）も別。プレビューで試したデータは本番に混ざらない。
- `manifest.webmanifest`: `display: standalone`、縦固定、アイコン 180/192/512、`start_url` と `scope` は `/`。
- iOS はホーム画面に追加して使う（通常の Safari タブでも動くが、保存領域が別になる旨をオンボーディングで説明）。

## Service Worker（vite-plugin-pwa, injectManifest）
- 役割: アプリ本体・Atlas・演出パックのプリキャッシュ（オフラインで起動できる）。Engine は回さない。
- 更新: 新しい SW を検知したら「更新があります」→ 再読み込み。セーブのスキーマ移行は起動時に行う（spec/10）。

## 保存
- IndexedDB（spec/10）。`navigator.storage.persist()` を初回に要求し、結果を設定画面に表示。
- **セーブの書き出し/読み込み**: `PH-SAVE1:` + base64(gzip(JSON{meta, claims, actions, settings, places}))。
  `CompressionStream` を使う。スナップショットは含めない（読み込み時に再計算）。
- 週1回「バックアップを書き出しましょう」を HUD に出す（最終書き出しから7日）。

## OS 連携
| 機能 | API | 扱い |
|---|---|---|
| ショートカット起動 | `location.href = 'shortcuts://run-shortcut?name=…'` | spec/31 |
| クリップボード | `navigator.clipboard.readText()`（ユーザー操作内） | 失敗時はテキスト欄 |
| 位置情報 | `navigator.geolocation.getCurrentPosition` | spec/32 |
| 音 | Web Audio（最初のタップで `AudioContext.resume()`） | spec/43 |
| バッジ | `navigator.setAppBadge(n)` | 背面へ移る時に「燃料切れまでの時間が 1h 未満なら 1」等。非対応なら無視 |
| 画面の点灯維持 | Screen Wake Lock | 使わない（MVP） |
| 振動 | `navigator.vibrate` | iOS 非対応。Android のみ best-effort |

## （任意・後期）Web Push — P8
- iOS 16.4+ のホーム画面 Web アプリで利用可、Apple Developer 登録は不要。送信には VAPID 鍵とサーバーが要る。
- 構成案: Cloudflare Workers（無料枠）＋ Durable Object alarm。背面へ移る時に `lookahead` で得た
  「燃料切れ時刻」「hot ≥ 4 の山場時刻」（最大 20件）と PushSubscription を Worker に送る → 予定時刻に Push →
  SW が通知表示＋`setAppBadge`。予定は次回の背面移行で上書き。
- 結果は Engine の決定論で確定済みなので、通知内容と開いた時の結果は一致する。
- 送るのは時刻と表示文言のみ（行動データ・位置は送らない）。
