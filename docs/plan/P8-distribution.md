# P8 Distribution & Optional Push（任意）

### P8-T1 README と他者向けセットアップ
Read: ref/tooling, spec/41-pwa-platform（配布節）
Accept:
- [ ] フォークして自分の Vercel に Import するだけで出せる手順 / 利用者向け「ホーム画面に追加」手順

### P8-T2 ショートカットの配布
Read: spec/31-shortcut-health
Accept:
- [ ] iCloud リンクと、リンクが使えない人向けの手作り手順（スクリーンショット付き）を `resources/shortcut/README.md` に

### P8-T3 （任意）Web Push
Owner: Claude Code | Read: spec/41-pwa-platform（Web Push 節）, spec/22-core-engine（lookahead）
Do: `workers/push`（Cloudflare Workers + Durable Object alarm, VAPID）、背面移行時の予定送信、SW の通知表示とバッジ。
D-014 の「サーバーなし」を変える判断なので、着手前に DECISIONS に記録。
Accept:
- [ ] 実機で、閉じている間に予定時刻の通知が届き、開いた結果と一致する
