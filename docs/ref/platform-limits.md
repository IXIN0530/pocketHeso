# Platform Limits（iOS 26 / iPhone 16e）
推測でコードを書かないこと。ここに無い制限値に依存する場合は、調べて出典付きで追記する。
「実測」列は P0 のスパイクで埋める。実測値が公称と違えば **実測を優先** する。

## 端末
| 項目 | 値 | 実測 |
|---|---|---|
| SoC / RAM | A18 (6C CPU / 4C GPU) / 8GB | |
| Dynamic Island | **なし（ノッチ）** → DI 用ビューは描画されない。コンパイル要件としてのみ実装 | |
| 脱獄 / TrollStore | 不可（Dopamine は A18 非対応、TrollStore は iOS 17.0 まで） | |

## Live Activity（ActivityKit）
| 項目 | 値 | 実測 |
|---|---|---|
| 表示場所（DI 非搭載機） | ロック画面・通知センター。`AlertConfiguration` 付き更新でホーム画面にバナー | |
| 寿命 | アクティブ最大8時間 + 終了後表示最大4時間 | |
| 同時起動数 | 1アプリ5件まで | |
| 描画反映間隔 | iOS 18+ で約15秒にコアレス（コミュニティ実測。速く update しても無視される） | ☐ P0-T3 |
| アニメーション | 状態遷移時のみ・最大2秒・常時表示ディスプレイでは無効 | |
| ContentState サイズ | 約4KB 上限 → **1KB 以下を目標** | |
| 事前スケジュール開始 | iOS 26 でサードパーティに開放 | ☐ 要API確認 |

## WidgetKit
| 項目 | 値 | 実測 |
|---|---|---|
| 拡張メモリ | 約30MB | |
| リロード予算 | 約40〜70回/日（アプリ前面化・ユーザー操作は予算外） | |
| タイムライン | 未来エントリを複数返せる → **60エントリ@1分** で1時間分を1リロードで賄う | ☐ P5-T4 |

## AlarmKit（iOS 26+）
- サイレントモード・集中モードを貫通して鳴る。アプリ終了後も発火する。
- 利用者のアプリ単位オプトイン必須。Info.plist に `NSAlarmKitUsageDescription`。
- **鳴動中の画面はシステム管理 UI**。自由なカスタム UI は countdown / paused 状態の Live Activity のみ。
- 追加ボタン（`AlarmButton` + App Intent）でアプリを開く導線を作る。
- 出典: https://developer.apple.com/videos/play/wwdc2025/230/

## Notification Content Extension
- 通常の `UIViewController`。SpriteKit / 動画 / 操作可能。
- メモリ上限は厳しい（公称値不明）→ 実測して記録。テクスチャは最小限。 ☐ P0-T5

## バックグラウンド
| 手段 | 用途 | 注意 |
|---|---|---|
| 無音オーディオ（`UIBackgroundModes: audio`、`.playback` + `.mixWithOthers`） | プロセス常駐 | 割り込み・経路変更で止まる→再開処理必須。電池消費大 | 
| `BGAppRefreshTask` | 追いつき計算のフォールバック | 実行タイミングは OS 任せ |
| `CMPedometer.queryPedometerData(from:to:)` | 過去の歩数取得（最大7日） | **常駐が死んでも歩数は失われない** |

## 取得不可
- システム全体の CPU 使用率（サンドボックスで他プロセス不可視、`host_get_host_priv_port` 失敗）。
  代替: `ProcessInfo.thermalState`、バッテリー、歩数、`CMMotionActivityManager`。

## 開発ツール
- Xcode 26.3+ の MCP（`xcrun mcpbridge`）: 20ツール、定義だけで約5Kトークン。常時有効にしない。

## 配布（日本）
- 2025/12/18 スマホ新法施行。iOS 26.2+ で代替アプリマーケットプレイス可（AltStore PAL 等）。
  App Store 外配信は「公証」が必要（App Review より軽い）。Webサイト直配信は現時点で EU 限定の記載あり（要確認）。
