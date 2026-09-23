# 30 Runtime（App プロセス）

## 構成（App ターゲット内 `Runtime/`）
| 型 | 責務 |
|---|---|
| `RuntimeCoordinator` (@MainActor) | 1Hz tick、Engine 前進、保存、サーフェス発行の調停 |
| `StepInputSource` | CMPedometer のライブ更新＋履歴クエリで InputLedger に追記 |
| `ThermalInputSource` | `thermalState` 変化を記録（MVP は演出の味付けのみ。抽選には影響させない） |
| `KeepAlive` | 無音オーディオ常駐。ON/OFF 設定、割り込み・経路変更からの復帰 |
| `StateStore` | App Group への原子的書き込み（一時ファイル → rename）、スキーマ版数 |
| `SurfacePublisher` | Projection を Live Activity / Widget / Alarm / 通知 に振り分け（spec 40〜42） |
| `CatchUp` | 起動・前面化・BGタスク時に、前回 tick〜現在の歩数履歴を取り込み Engine を前進 |

## tick（1Hz）
1. 歩数差分を ledger に追記（ライブ値）
2. `engine.advance(to: now)` → 新イベントを `events.jsonl` に追記、10 tick ごとに snapshot 保存
3. `project(...)` → `projection.json` 書き込み
4. `SurfacePublisher.publish(projection, newEvents)`（各サーフェスが自前でスロットリング）

## 追いつき（CatchUp）
- 最後に取り込んだ歩数の時刻 `lastInputAt` を保存。復帰時に
  `CMPedometer.queryPedometerData(from: lastInputAt, to: now)` で差分取得（最大7日遡れる）。
- 取得区間は1分単位に分割して ledger に追記（発射時刻の分布を自然にするため）。
- 長時間（例: 8時間）でも Engine は Atlas 参照のみなので数百ms で終わる想定。P4-T3 で計測。

## KeepAlive
- `AVAudioSession`: category `.playback`, options `.mixWithOthers`。`AVAudioEngine` でゼロ埋めバッファをループ。
- 監視: `interruptionNotification`（終了時に再開）、`routeChangeNotification`、`mediaServicesWereReset`。
- 停止を検知できないケースに備え、tick が 30秒以上空いたら次の起動時に CatchUp が埋める（結果は同一: 決定論）。
- 設定: `keepAlive: on | off | chargingOnly`。既定 `on`（優先度1）。

## 権限
Motion（歩数）、通知、AlarmKit、（Live Activity は設定で許可）。初回起動のオンボーディングでまとめて要求。
