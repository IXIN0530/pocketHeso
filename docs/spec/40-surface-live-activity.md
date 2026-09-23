# 40 Surface: Live Activity

## Attributes
```swift
struct HesoActivityAttributes: ActivityAttributes {   // PachinkoShared
  typealias ContentState = SurfaceProjection          // ≤ 1KB
  var machineName: String
  var startedAt: SimTime
}
```

## ビュー（Widgets 拡張）
- ロック画面/通知センター（**主戦場**）: 高さを使い切る縦構成
  - 上段: モード表示（通常 / ST 残り n 回 / 大当たり R n/N）＋持ち玉統計
  - 中段: 保留4つ（色付き丸、金は輝き）＋変動中なら `Text(timerInterval:)` で残り時間
  - 下段: 「次の熱い予定」`nextHot`（例: 「保留3 ◉赤」）、打ち出し ON/OFF ボタン（App Intent）
- Dynamic Island 用ビュー: コンパイル要件を満たす最小実装（16e では表示されない）。
- 状態遷移アニメは `.contentTransition(.numericText())` 程度。2秒制限を超えない。

## 更新スケジューラ（`SurfacePublisher.LiveActivityChannel`）
- 最小間隔 `minInterval` = platform-limits の実測値（初期 15秒）。それ未満の要求は最新値で上書きして保留。
- 即時送信するイベント: `holdAdded`（色が white 以外）、`spinStarted`（hot ≥ 1）、`jackpotStarted`、`modeChanged`。
  ただし minInterval は守る（守らないと捨てられる）。
- `AlertConfiguration` を付ける条件: hot ≥ 設定値（既定 3）、または金保留。1時間あたり上限（既定 6 回）。
- `staleDate` = 次の予定イベント時刻 + 60秒。
- ローテーション: 開始から 7時間45分で新しい Activity を request → 旧を `.immediate` で end。
  プロセスが死んでいた場合は次の起動時に張り直す。

## 失敗時
- `ActivityAuthorizationInfo().areActivitiesEnabled == false` → アプリ内に案内、ウィジェットのみで継続。
