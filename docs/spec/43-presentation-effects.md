# 43 Presentation Effects: 音・光・振動

## 目的
実機パチンコのような「音」「派手な光（虹フラッシュ等）」「振動」を、**コードを変えずにデータで足し引き・強弱調整**できるようにする。
MVP は最小のキューだけ入れ、素材と CueSheet を後から増やしていく前提。

## サーフェス別にできること（iOS 26 / 16e）
詳細な制限値・実測は ref/platform-limits.md「演出（音・光・振動）」節。

| サーフェス | 音 | 光・色 | 振動 |
|---|---|---|---|
| アプリ前面 | ◎ AVAudioEngine で BGM/SE/ボイス多重 | ◎ SKShader（虹・フラッシュ）、SKEmitterNode、画面輝度、背面ライト | ◎ Core Haptics（AHAP） |
| アプリ背景（KeepAlive 中） | ○ `.playback` セッション中なので鳴らせる（設定で制御） | × | × |
| 通知コンテンツ拡張 | △ AVAudioPlayer 1本（要実測） | ○ SpriteKit（テクスチャ 20MB 以内） | △ 要実測 |
| ローカル通知 | ○ `UNNotificationSound(named:)` 30秒未満 | × | システム既定のみ |
| Live Activity 更新 | ○ `AlertConfiguration` の `.named`（要実測） | △ 静的グラデ（虹枠等）＋遷移アニメ ≤2秒 | システム既定のみ |
| AlarmKit | ○ `.named`（iOS 26.0 で不具合報告あり → 既定音フォールバック） | 鳴動画面はシステム UI。countdown の LA のみ △ | システム既定のみ |
| ロック画面ウィジェット | × | △ 単色描画になり得る（形で区別, spec 41） | × |

## 設計: 演出はデータ（CueSheet）
- `CueSheet`（**PachinkoShared**, Codable の純データ）: パターン ID ごとの時刻付きキュー列。
  ```json
  {"pattern": "spsp_gekiatsu", "cues": [
    {"at": 0,     "kind": "sound",  "bus": "bgm", "asset": "sp_reach_loop"},
    {"at": 41200, "kind": "flash",  "style": "rainbow", "ms": 800, "min_intensity": 2},
    {"at": 41200, "kind": "sound",  "bus": "se",  "asset": "kyuin"},
    {"at": 41200, "kind": "haptic", "asset": "kyuin"}]}
  ```
  - `kind`: `sound` / `flash` / `particle` / `haptic` / `torch` / `brightness`。未知の kind は無視（前方互換）。
  - `min_intensity`: 設定の強度（1〜3）未満ならスキップ。「派手さ」の段階はここで作る。
  - 分岐（群予告の有無など）は `RNGStream(seed, .presentation, index: serial)` で決める → 同じ seed で同じキュー列。
    **Core の抽選結果には触れない**（spec 21 乱数ストリーム節）。
- 演出パック `Packs/<name>/`（アプリ同梱。MVP は `default` の1つ）:
  `pack.json`（CueSheet 群・テーマ色）/ `sounds/*.caf|*.m4a` / `haptics/*.ahap` / `shaders/*.fsh`
  - 通知・LA・AlarmKit の音はメインバンドルか `Library/Sounds` にある必要がある → 起動時に使う分を `Library/Sounds` へ同期。

## レンダラ（PachinkoPresentation）
| 型 | 役割 |
|---|---|
| `CuePlayer` | CueSheet を SimTime 同期で実行。途中から再生できる（開いた瞬間に山場の途中なら途中から） |
| `SoundBus`（protocol） | バス `bgm` `se` `voice`、バス別音量。実装: App=`EngineSoundBus`（AVAudioEngine）、拡張=`PlayerSoundBus`（AVAudioPlayer） |
| `FlashRenderer` | SpriteKit のオーバーレイ。虹は SKShader の色相回転。Metal 直書きは不要（足りなければ差し替え点） |
| `HapticPlayer` | Core Haptics で AHAP を再生。非対応・背景時は no-op |
| `SurfaceDegrader` | キューを各サーフェスの能力に落とす（例: 虹 flash → LA では `SurfaceFX.accent = .rainbow` の静的枠、通知では音のみ） |

- App の `EngineSoundBus` は KeepAlive（spec 30）と **同じ AVAudioEngine を共用**する（セッション・エンジンの二重化で常駐が落ちるのを防ぐ）。
- Presentation の描画コードは物理の「sin/cos 禁止」ルールの対象外（対象は Core の物理内側ループのみ）。

## 調整つまみ（`settings.json` → SettingsView）
| キー | 既定 | 内容 |
|---|---|---|
| `fx.intensity` | 2 | 1 控えめ / 2 標準 / 3 派手。パーティクル量・フラッシュ強度の倍率と `min_intensity` 判定 |
| `sound.volume.{master,bgm,se,voice}` | 0.8 | バス別音量 |
| `sound.background` | `headphonesOnly` | `off` / `headphonesOnly` / `always`。背景で鳴らすか（`AVAudioSession.currentRoute` で判定） |
| `fx.haptics` | on | 振動 |
| `fx.torch` | off | 背面ライト点滅（アプリ前面のみ） |

- 消音スイッチの状態は公開 API で取れず、`.playback` は消音スイッチを無視する → アプリ内ミュート（`master = 0`）で代替し、
  オンボーディングで説明する。
- **光過敏の安全策（強度設定で外せない）**: フラッシュは 1秒あたり 3回以下にクランプ、全画面の急激な明滅は輝度差を制限。
  `UIAccessibility.isReduceMotionEnabled` の時は flash をフェードに置換。

## チューニング導線（DEBUG）
- DebugView に「演出プレビュー」: パターン・当否・seed を選んで再生、キューのタイムライン表示、強度切替。
- シミュレーター時は `Documents/Packs/` の pack.json をホットリロード（素材差し替えを再ビルドなしで確認）。

## 素材
- 自作またはライセンス確認済みのフリー素材のみ。実機種の音・映像は使わない（spec 00 Non-goals）。
- 通知/Alarm 用の音は 30秒未満・`.caf`（LPCM/IMA4）。拡張で読む音声の合計サイズは実測で上限を決める。

## 性能
- 全画面の虹 SKShader + 20玉 + 液晶演出で 16e 60fps（spec 50 の目標に含める）。
