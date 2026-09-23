# 41 Surface: Lock Screen Widgets

## 種類
| kind | family | 内容 |
|---|---|---|
| `HoldInline` | `.accessoryInline` | `◉◉◉○ ST42`（保留＋モード短縮）。色は SF Symbols + `foregroundStyle` |
| `HoldRect` | `.accessoryRectangular` | 保留4＋回転数＋当たり回数＋変動残り |
| `BoardSmall` | `.systemSmall`（ホーム画面, 任意） | 保留＋統計 |

注: ロック画面ウィジェットは端末設定によって単色描画になる。色だけに意味を持たせず、記号も変える
（白 ○ / 青 ◔ / 緑 ◑ / 赤 ◕ / 金 ★ のように形でも区別）。

## タイムライン
- Provider は App Group の `timeline.json`（`[SurfaceProjection]` 60件, 1分刻み）を読むだけ。
- App 側が生成: `projectTimeline(from: 現在分の頭, every: 60_000, count: 60)`。
- リロード方針: `policy: .after(最後のエントリ時刻)`。App は下記の時だけ `reloadTimelines(ofKind:)`:
  - 新しい保留/モード変化が既存タイムラインと食い違った時（最短10分間隔）
  - 前面化時（予算外）
- 1日のリロード回数を StateStore に記録し、予算の 80% を超えたら30分間隔に落とす。
