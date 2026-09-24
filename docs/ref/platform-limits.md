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
| 「ヘルスケアサンプルを検索」 | 種類・期間・並べ替え・グループ化（日）・件数制限が可能 | ☐ P0-T3 |
| オートメーション（時刻） | 確認なし実行を設定できる。ロック中は上記により失敗し得る | ☐ P0-T3 |
| PWA から `shortcuts://run-shortcut` | 要実測 | ☐ P0-T3 |
| ショートカット → PWA への受け渡し | URL を開くと Safari（PWA とは別の保存領域）→ **クリップボード経由** | ☐ P0-T3 |
- 出典: https://support.apple.com/en-om/guide/security/sec88be9900f/web（Health data protection）/
  https://blog.maximeheckel.com/posts/build-personal-health-api-shortcuts-serverless/

## PWA（iOS Safari / ホーム画面 Web アプリ）
| 項目 | 値 | 実測 |
|---|---|---|
| 保存領域 | ホーム画面アプリと Safari タブは別。`storage.persist()` の結果 | ☐ P0-T5 |
| 背景実行 | 不可（タイマー・位置・音はすべて止まる前提） | |
| 位置情報 | 前面の `getCurrentPosition` のみ。許可が毎回聞かれるか | ☐ P0-T4 |
| 屋内の位置精度 | `coords.accuracy` の実測（ジム・公園） | ☐ P0-T4 |
| クリップボード読み取り | ユーザー操作内で `readText()`、iOS は「ペースト」確認 UI | ☐ P0-T3 |
| Web Audio | 最初のタップで resume。消音スイッチ時の挙動 | ☐ P0-T5 |
| Web Push | iOS 16.4+、ホーム画面 Web アプリのみ。サーバーと VAPID が必要 | （P8） |
| バッジ | `navigator.setAppBadge`（ホーム画面 Web アプリ、通知許可が必要な場合あり） | ☐ P8 |
| 振動 | `navigator.vibrate` 非対応 | |
| 描画性能 | Pixi で 20玉＋フィルタ 60fps | ☐ P0-T5 |

## OpenStreetMap / Overpass API
| 項目 | 値 |
|---|---|
| 公開サーバー | 無料だが高負荷。キャッシュ必須、連打しない（1セッション2回まで, spec/32） |
| タグ | `leisure=fitness_centre`（ジム）/ `fitness_station`（公園の健康器具, 自治体設置が多い）/ `sports_centre` / `park` / `pitch` / `track` / `swimming_pool` |
- 出典: https://wiki.openstreetmap.org/wiki/Overpass_API , https://wiki.openstreetmap.org/wiki/Tag:leisure=fitness_station

## JS の決定論
- `+ - * /` と `Math.sqrt` は IEEE 754 で正しく丸められる（どのエンジンでも同じ結果）。
  `Math.sin/cos/exp/log/pow/hypot` と `**` は実装依存の丸めがあり得る → Core で禁止。
- `Array.prototype.sort` は ES2019 以降で安定。比較関数は全順序にすること。
- 整数演算は `Math.imul`、`>>> 0`、`| 0` で 32bit に閉じる。BigInt は使わない（D-016）。
