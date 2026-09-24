# Platform Limits（Web / PWA on iOS 26 + ショートカット）
推測でコードを書かないこと。ここに無い制限値に依存する場合は、調べて出典付きで追記する。
「実測」列は P0 のスパイクで埋める。実測値が公称と違えば **実測を優先**。
iOS ネイティブ時代の制限値は docs/archive/native-v1/ref/platform-limits.md（通常は読まない）。

## 端末
| 項目 | 値 | 実測 |
|---|---|---|
| 主対象 | iPhone 16e（A18, RAM 8GB）/ iOS 26.x / Safari・ホーム画面 Web アプリ | |
| 副対象 | Android Chrome、PC ブラウザ（ショートカット連携なし） | |

## Apple アカウント
- 有料 Developer Program は不要。ショートカットは純正アプリなのでヘルスケア読み取りに開発者登録は関係しない。
- 参考: Personal Team では APNs が使えず、Live Activity も `pushType: .token` では開始できない（ネイティブを捨てた理由の一つ）。
  出典: https://github.com/LoopKit/Loop/issues/2532 , https://developer.apple.com/forums/thread/718388

## ヘルスケア × ショートカット
| 項目 | 値 | 実測 |
|---|---|---|
| ロック中の読み取り | ロック後10分で暗号化され読めない → 手動実行を主経路に | ☐ P0-T3 |
| 「ヘルスケアサンプルを検索」 | 種類・期間・並べ替え・グループ化（日）・件数制限が可能 | ✅ 日ごとの範囲指定＋統計「合計」で3日分取得。歩数はヘルスケアアプリの表示と3日とも一致。注意: 「数値を書式設定」は桁区切り `,` を入れる（正規表現で除去）、Base64 は既定で76文字改行、「日付を調整」の出力も「現在の日付」と表示される。サンプルが256件を超えると「大量のデータの共有を許可」（設定→アプリ→ショートカット→詳細）が必要。「数値を丸める」は検索に出ない |
| ワークアウトの読み取り | 「ヘルスケアサンプルを検索」の種類にワークアウトがある想定だった | ❌ iOS 26 で種類に無い。ワークアウト系アクションは開始/記録/終了（書き込み・操作）のみで読み出し不可 → 取得しない（D-022） |
| オートメーション（時刻） | 確認なし実行を設定できる。ロック中は上記により失敗し得る | ⚠ 設定・実行はできるが、通知は「オートメーションを実行中」のみで成否が分からない。出力はクリップボードだけで `gen` ±30分の鮮度チェックにより貼り付けが遅れると無効 → 使わない（D-023） |
| PWA から `shortcuts://run-shortcut` | `location.href` で起動可 | ✅ standalone で起動（blur/hidden +1s）。戻ると focus・`visibilitychange→visible` が来る |
| ショートカット → PWA への受け渡し | URL を開くと Safari（PWA とは別の保存領域）→ **クリップボード経由** | ✅ 手動ペースト（欄を長押し→ペースト）は確実。API 読み取りは下記の通り不安定 |
- 出典: https://support.apple.com/en-om/guide/security/sec88be9900f/web（Health data protection）/
  https://blog.maximeheckel.com/posts/build-personal-health-api-shortcuts-serverless/

## PWA（iOS Safari / ホーム画面 Web アプリ）
| 項目 | 値 | 実測 |
|---|---|---|
| 保存領域 | ホーム画面アプリと Safari タブは別。`storage.persist()` の結果 | ☐ P0-T5 |
| 背景実行 | 不可（タイマー・位置・音はすべて止まる前提） | |
| 位置情報 | 前面の `getCurrentPosition` のみ。許可が毎回聞かれるか | ⚠ ホーム画面アプリでも**起動のたびに許可を聞かれる**（起動時の `permissions.query` は `prompt`）。前面にいる間は2回目以降が数 ms で返る |
| 屋内の位置精度 | `coords.accuracy` の実測（ジム・公園） | ✅ 自宅（屋外・窓際）7〜17m（計9回）。初回の取得は約1.8秒。屋内ジムは未計測（P4） |
| クリップボード読み取り | ユーザー操作内で `readText()`、iOS は「ペースト」確認 UI | ⚠ 自アプリが書いた内容は `readText()` 可。他アプリ（ショートカット）由来は `NotAllowedError` が即時に返ることが多い（`readText` 4/4 失敗、`read()` 1回目失敗・2回目成功）。確認 UI は未観測 → API を試し、失敗時は手動ペーストへ誘導する |
| Web Audio | 最初のタップで resume。消音スイッチ時の挙動 | ☐ P0-T5 |
| Web Push | iOS 16.4+、ホーム画面 Web アプリのみ。サーバーと VAPID が必要 | （P8） |
| バッジ | `navigator.setAppBadge`（ホーム画面 Web アプリ、通知許可が必要な場合あり） | ☐ P8 |
| 振動 | `navigator.vibrate` 非対応 | |
| 描画性能 | Pixi で 20玉＋フィルタ 60fps | ☐ P0-T5 |

## 施設検索（YOLP / OpenStreetMap）
| 項目 | 値 |
|---|---|
| YOLP ローカルサーチ（採用, D-025） | `lat`/`lon`/`dist`(km)/`gc` で検索、0.1〜0.2秒。CORS 非対応（`Access-Control-Allow-Origin` 無し）→ JSONP（`application/javascript`）。1アプリ 50,000件/日。結果は点のみ |
| YOLP の規約 | 取得データの保存（キャッシュ含む）禁止。クレジット「Webサービス by Yahoo! JAPAN」を画面下部に表示 |
| YOLP の網羅 | 公開 API は Yahoo!マップのアプリよりデータが少ない（自宅周辺の公園・ジム各1件がキーワード検索でも0件, 2026-09 実測） |
| 公開 Overpass（不採用） | overpass-api.de は 2026-09 に Wi-Fi・モバイルとも全リクエスト 406（CORS 無し → Safari では `Load failed`）。ミラーは 10〜57秒か 504 |
| OSM のタグ | 小さな公園は `park` でなく `leisure=playground` で載っていることがある（自宅周辺 1km で名前なし3件） |
- 出典: https://developer.yahoo.co.jp/webapi/map/openlocalplatform/v1/localsearch.html , https://developer.yahoo.co.jp/attribution/ ,
  https://wiki.openstreetmap.org/wiki/Overpass_API

## JS の決定論
- `+ - * /` と `Math.sqrt` は IEEE 754 で正しく丸められる（どのエンジンでも同じ結果）。
  `Math.sin/cos/exp/log/pow/hypot` と `**` は実装依存の丸めがあり得る → Core で禁止。
- `Array.prototype.sort` は ES2019 以降で安定。比較関数は全順序にすること。
- 整数演算は `Math.imul`、`>>> 0`、`| 0` で 32bit に閉じる。BigInt は使わない（D-016）。
