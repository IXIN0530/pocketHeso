# 10 Architecture

## モジュール（依存は上→下のみ。逆方向・横方向の import 禁止）
```
App (PocketHeso)            Widgets ext            NotificationContent ext
  │  SwiftUI/SpriteKit        │ WidgetKit/ActivityKit  │ UserNotificationsUI
  ├──────────────┬────────────┴──────────┬────────────┘
  ▼              ▼                       ▼
PachinkoPresentation ──────────► PachinkoShared
  (SpriteKit 演出シーン,          (App Group 永続化, ActivityAttributes,
   CuePlayer/SoundBus/            Projection の Codable 型, 設定,
   FlashRenderer/HapticPlayer)    CueSheet・SurfaceFX の純データ型)
  ▼                                      │
PachinkoCore ◄───────────────────────────┘
  (純 Swift。物理・抽選・Engine・Atlas・Projection。macOS/iOS 両対応)
  + pachisim (macOS CLI executable, Core と同一パッケージ)
```

## ターゲット（project.yml）
| ターゲット | 種別 | 依存 | 主な capability |
|---|---|---|---|
| PocketHeso | iOS app | Core, Shared, Presentation | App Groups, Background Modes(audio, fetch), Motion, AlarmKit |
| PocketHesoWidgets | Widget Extension | Core, Shared | App Groups。Live Activity + ロック画面ウィジェット + AlarmKit の Live Activity |
| PocketHesoNotificationContent | Notification Content Ext | Shared, Presentation | App Groups |

- 演出（spec 43）: AVFoundation（AVAudioEngine）/ Core Haptics / SpriteKit（SKShader, SKEmitterNode）は Presentation と App のみ。
  Widgets 拡張は CueSheet から作られた `SurfaceFX`（Shared の純データ）を読むだけ。演出パックは App バンドルの `Packs/`。
- Deployment target: iOS 26.0。Swift 6。Bundle prefix / Team / App Group は project.yml の settings で一元管理。
- App Group: `group.$(BUNDLE_PREFIX).pocketheso`

## データフロー
```
CMPedometer ─► InputLedger ─┐
thermalState ───────────────┤
                            ▼
                 Engine.advance(to: now)  ──► [SimEvent]（追記保存）
                            │
                            ▼
                 Projection（純関数）
      ┌─────────┬──────────┼────────────┬─────────────┐
      ▼         ▼          ▼            ▼             ▼
 LiveActivity  Widget     Alarm       Notification   App 描画
  State      60 entries  schedule     payload        (SpriteKit)
```
- Engine の真実は「seed + spec + board + atlas + InputLedger」。イベント列とスナップショットはキャッシュ。
- 拡張は Engine を回さない。App Group の最新 Projection / タイムラインを読むだけ（例外: 通知拡張は演出再生のため Presentation を使う）。

## 状態の保存（App Group コンテナ）
`state/snapshot.json`（Engine スナップショット）/ `state/ledger.jsonl`（入力追記）/
`state/events.jsonl`（直近24hのみ）/ `state/projection.json`（拡張が読む）/ `settings.json`
