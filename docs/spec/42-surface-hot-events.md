# 42 Surface: 激アツ演出（Hot Events）

## 熱さレベル
`hot` = max(パターン hot, 保留色ボーナス[red+1, gold→5])、0〜5。設定で閾値を持つ:
| 設定 | 既定 | 手段 |
|---|---|---|
| `bannerAt` | 3 | Live Activity の AlertConfiguration（spec 40） |
| `notifyAt` | 4 | ローカル通知（カテゴリ `HOT_EVENT`）→ 通知コンテンツ拡張で演出 |
| `alarmAt` | 5 | AlarmKit（サイレント貫通）。**既定 OFF**（うるさいので明示オプトイン） |

## 予約の考え方
- 取得時に当否もパターンも確定している → 演出の「山場の時刻」を事前に計算できる
  （`spinStarted.at + pattern.climaxOffsetMs`）。
- 予約は `lookahead` で見えている範囲だけ。歩数が変わって予定がずれたら取り消し→再予約。
- 通知: `UNCalendarNotificationTrigger` ではなく `UNTimeIntervalNotificationTrigger`。識別子 `hot-<entrySerial>`。
- AlarmKit: countdown 型で予約。Live Activity（countdown 状態）に保留色と「激アツ」表示。
  追加ボタン「見る」→ `OpenIntent` でアプリを演出再生画面で起動。

## 通知ペイロード（userInfo）
`{"v":1, "entry": <serial>, "seed": <UInt64 as String>, "pattern": "<id>", "hot": 4, "hold_color": "red", "result": "hit|miss"}`
- 結果を含むので、演出は完全に再現可能（同じ seed + pattern → 同じ演出）。

## 通知コンテンツ拡張
- `UNNotificationContentExtension` + `SKView`。`PachinkoPresentation.PresentationScene(entry:, seed:, pattern:)` を再生。
- メモリ: テクスチャ合計 20MB 以内（実測で調整, P0-T5）。音は `AVAudioPlayer` 1本。
- 再生後に結果表示 →「アプリで見る」ボタン。

## PachinkoPresentation
- SpriteKit シーン群。入力は `(pattern, result, seed)` のみ。**Core の抽選結果を変えない**。
- 演出の分岐乱数は `RNGStream(seed, .presentation, index: serial)`。
- MVP 演出: 通常リーチ / SP リーチ / 激アツ（疑似連 + 群予告）/ 確定（プレミア）。素材は図形とテキストのみ。
