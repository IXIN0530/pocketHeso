# P8 Release（一般公開・正式版）
目的: 一般プレイヤーに配れる正式版を `main` に出す。開発用の表示は正式版のビルドだけから消し、`dev`（プレビュー）には残す（D-087）。
ショートカットは全員共通の iCloud リンク1つで入り、鍵を貼る手順をなくす（D-088）。

- P7 と並行で進めてよい（STATUS の `Parallel` 行）。ただし **同じ作業ツリーで2つのエージェントを同時に走らせない**（どちらも `dev` にコミットする）。
- 順番: T1 → T2 → T4 → T5 は P7 と独立。T3 は T2 の後（P7-T11 の階数は待たない, D-089）。T6 は全部の後、人間の指示がある時だけ。
- レビューは `/review P8-Tn` を書いた側と別のエージェントで（Claude のトークン節約なら agy）。

### P8-T1 正式版ビルドの切り替え（開発用の表示を本番から落とす）
Owner: Muse Spark | Read: spec/40-app-ui（画面の表の Debug・設定の行）, spec/41-pwa-platform（配布）
Do:
- `apps/web/vite.config.ts` の define を `__DEV_TOOLS__` = `VERCEL_ENV !== 'production' && PH_RELEASE !== '1'` に置き換える（`__SHOW_SPIKES__` は廃止、`build-flags.d.ts` も）。
  vitest でも定義されること。あわせて `__APP_VERSION__`（ルート `package.json` の version。1.0.0 にする）。
- `__DEV_TOOLS__` が false の時に消すもの（**ファイルは消さず**、`if (__DEV_TOOLS__)` / `__DEV_TOOLS__ && …` の定数分岐で本番バンドルから落とす）:
  1. Debug タブと `?debug=1`（`app/app.tsx` の lazy import ごと。`stores/clock.ts` の `debugScaleFrom` は常に 1 → Debug 用 DB も開かない）
  2. `?spike=`（`main.tsx` の SpikeRoot の lazy import ごと）と設定の spike リンク
  3. 設定の「計測ログ」（`LogPanel`）と「Core v…」の表示（代わりに「バージョン v{__APP_VERSION__}」を常に出す）
  4. `platform/yolp.ts` の localStorage の代替 ID（`ph.spike.yolpAppid`）。本番はビルド時の `VITE_YOLP_APPID` だけ
- ほかに一般プレイヤーに不要な表示（開発用語・P番号・spike・Debug への言及）を `apps/web/src` の画面から探し、同じ分岐に入れるか文言を直す。
  何をどうしたかをコミット本文に箇条書きで残す。
- `scripts/release-check.sh` を作る: `PH_RELEASE=1` で web をビルドし、`apps/web/dist` に目印の文字列（`spike:`・`Grant 注入`・`演出プレビュー`・
  `計測ログ`・`ph.spike.`）が1つも無ければ OK。続けて通常ビルドし、`Grant 注入` が有ること（dev に残っていること）を確認。出力は `_lib.sh` の流儀で。
- spec/40 の Debug 行（済: 本番に無い旨）・ref/tooling のスクリプト表に release-check を追記。
Accept:
- [ ] `scripts/release-check.sh` が OK
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機（人間）: dev のプレビューで Debug タブ・spike・計測ログが今まで通り出る（本番側の確認は T6）

### P8-T2 ショートカット連携を簡単に（鍵を URL で渡す・導入ガイド）
Owner: Muse Spark | Read: spec/31-shortcut-health, spec/40-app-ui（行動の行）
Do:
- `platform/shortcut.ts`: `shortcutUrl(key)` = `shortcuts://run-shortcut?name=PocketHeso%20Sync&input=text&text=<encodeURIComponent(鍵)>`、
  `runShortcut(key)`。`SHORTCUT_ICLOUD_URL`（`VITE_SHORTCUT_URL` があればそれ、無ければ定数。定数は T3 まで空文字）。
- 鍵は利用者に見せる前提をやめる: 「ショートカット連携を始める」ボタンを廃止し、初めての受け取りで自動生成する。
- 行動タブのショートカット欄を2状態に（`screens/shortcut-panel.tsx`）:
  - **準備**（settings に `shortcutReadyAt` が無い）: 番号付きの3手順。
    ①「ショートカットを追加」（`SHORTCUT_ICLOUD_URL` を開く。空なら「準備中」と作り方の README へのリンク）
    ②「設定 → アプリ → ショートカット → 詳細 →『大量のデータの共有を許可』をオン」の説明（`App-prefs:` などの非公開 URL は使わない）
    ③「試しに受け取る」（＝運動を受け取る → 戻って貼り付け）。受け取りが初めて成功したら `shortcutReadyAt` を保存。
  - **毎回**（保存後）: 「運動を受け取る」「貼り付けて受け取る」の2ボタンだけ。小さく「準備をやり直す」（`shortcutReadyAt` を消す）。
  - 鍵の表示・コピーと手で貼る欄は折りたたみ「詳細（手作り・旧版のショートカット用）」へ移す。
- 受け取りエラーの文言に次の一手を足す（鍵不一致 →「ショートカットを追加し直してください」、壊れた・古い → 「もう一度 運動を受け取る」）。
- `resources/shortcut/README.md`: 利用者向け 1-1 を新しい流れ（鍵を貼らない）に書き直す。作者向け 2-1 を次に差し替え、2-4（読み込み時の質問）は削除して「旧版は読み込み時の質問で鍵を入れていた」と1行残す。
  - ショートカットの詳細で入力を受け取る設定: 種類 **テキスト**、入力がない場合 **停止して応答**「PocketHeso の『運動を受け取る』から実行してください」
  - 1 のテキストを削除し、「変数を設定」`鍵` の入力を **ショートカットの入力**（Shortcut Input）にする
  - URL から渡した入力が届かない場合は、受け取り元に「共有シート」を足して再確認する（結果を README に残す）
Accept:
- [ ] web のテスト: `shortcutUrl` が `input=text&text=` と鍵（エンコード済み）を含む、`shortcutReadyAt` の有無で準備/毎回が切り替わる
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機は T3 でまとめて確認（dev を push して終える）

### P8-T3 配布版ショートカットと iCloud リンク
Owner: 人間（iPhone）＋ Muse Spark（記入） | Read: resources/shortcut/README.md | 前提: P8-T2 が dev に push 済み（P7-T11 は待たない, D-089）
Do:
- 人間: 自分の `PocketHeso Sync` を README 2-1（入力で鍵）に直し、dev プレビューから受け取れることを確認 →
  README 2-5 で iCloud リンクを作る → 自分のショートカットを削除し、リンクから追加し直して受け取れることを確認（＝利用者と同じ流れ）。
- エージェント: 人間から受け取ったリンクを `SHORTCUT_ICLOUD_URL` と README 冒頭に記入。iOS の表記が README と違った所を直す。
Accept:
- [ ] 実機: リンクから追加 → 鍵を入力せずに ①〜③ が通り、受け取り確認に歩数・距離が出る（階数は P7-T11 で足す時にリンクを作り直す）
- [ ] 実機: ショートカットアプリから直接実行すると「PocketHeso の『運動を受け取る』から…」で止まる
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る

### P8-T4 はじめての案内と「このアプリについて」
Owner: Muse Spark | Read: spec/40-app-ui（画面・操作感）, spec/41-pwa-platform（配布）
Do:
- 初回起動（settings に `onboardedAt` が無い）で下からのシート（`components/sheet`）を3枚、スキップ可:
  ① 何のゲームか（良い行動 → 燃料（営業時間）→ 役物が回って玉が増える → 強化・パチンコ）
  ② ホーム画面に追加（`isStandalone()` が false の時だけ。Safari の共有 →「ホーム画面に追加」。ブラウザとホーム画面は保存が別）
  ③ 行動の受け取り方（行動タブ: ショートカット・トレーニングのチェックイン。データは端末の外に出ない）
  閉じたら `onboardedAt` を保存。既存のセーブ（玉や記録がある）では出さない。
- 設定の「アプリ」に「はじめての案内をもう一度」と「このアプリについて」（シート）:
  行動・位置は端末の外に送らない／施設を探す時だけ現在地の座標を Yahoo! に送る（D-025）／YOLP のクレジット（`YOLP_CREDIT`）／
  セーブは端末の中だけ → 機種変更の前に書き出す／ソース（GitHub リンク）とライセンス。
Accept:
- [ ] web のテスト: 新規では案内が出て、閉じると次の起動で出ない。既存セーブでは出ない
- [ ] `scripts/build.sh`・`scripts/test.sh all` が通る
- [ ] 実機（人間, T6 の前でよい）: Safari とホーム画面の両方で初回案内の見え方

### P8-T5 README・LICENSE・フォークして出す手順
Owner: Muse Spark | Read: ref/tooling, spec/41-pwa-platform（配布） | 前提: 人間がライセンスを決める（未決なら Blockers に書いて止まる）
Do:
- `README.md` を2部に: **遊ぶ人向け**（何のゲームか・本番 URL・ホーム画面に追加・ショートカットの入れ方（iCloud リンク）・プライバシー・セーブの書き出し）と
  **開発者向け**（セットアップ・フォークして Vercel に Import するだけで出せる手順・環境変数 `VITE_YOLP_APPID`・`dev`/`main` の運用・`release-check`）。
- `LICENSE` を置き、ルート `package.json` に `license`。
- 音・画像・盤面素材に第三者の版権物が無いことを確認（`images/` は .gitignore 済み）。出所を README に1行。
Accept:
- [ ] README の手順だけで、フォークから自分の Vercel 本番が出せる（手順に抜けが無いことを人間が読んで確認）
- [ ] `scripts/build.sh` が通る

### P8-T6 正式版のリリース（main へ）
Owner: Muse Spark | Read: ref/tooling（デプロイ） | 前提: **人間の「リリースしてよい」の指示**。STATUS の Blockers（バランス・既定機種）が解決済みか、人間が「このまま出す」と明言
Do:
1. `dev` で `scripts/build.sh`・`scripts/test.sh all`・`scripts/release-check.sh` が通る。
2. 人間に Vercel の設定確認を依頼: Production の環境変数 `VITE_YOLP_APPID`、本番ドメイン（Production は Deployment Protection なし）。
3. `git checkout main && git merge --ff-only dev && git tag v1.0.0 && git push origin main v1.0.0 && git checkout dev`。
   fast-forward できなければ何もせず Blockers に書いて止まる（main に直接コミットしない, D-019）。
4. 人間に本番の確認を依頼（下）。結果を STATUS Notes に。
   - 本番 URL で Debug タブが無い。`/?debug=1&x=60`・`/?spike=shortcut` を開いても通常の画面・x1
   - 設定に計測ログ・spike が無く、バージョン v1.0.0。初回案内が出る
   - ホーム画面に追加 → iCloud リンクのショートカットで受け取れる
   - 自分のプレイを引き継ぐ場合: プレビューで「セーブを書き出し」→ 本番で読み込み（オリジンが別, spec/41）
- 以後のリリースは 1〜4 を繰り返し、タグを `v1.x.y` に上げる（ルート `package.json` の version も同じに）。
Accept:
- [ ] `main` と `dev` が同じコミットで、`v1.0.0` タグが付いている
- [ ] 本番の確認（上の4項目）が人間から OK

### P8-T7 （任意）Web Push
Owner: Claude Code | Read: spec/41-pwa-platform（Web Push 節）, spec/22-core-engine（lookahead）
Do: `workers/push`（Cloudflare Workers + Durable Object alarm, VAPID）、背面移行時の予定送信、SW の通知表示とバッジ。
D-014 の「サーバーなし」を変える判断なので、着手前に DECISIONS に記録。
Accept:
- [ ] 実機で、閉じている間に予定時刻の通知が届き、開いた結果と一致する
