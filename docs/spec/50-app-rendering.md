# 50 App Rendering（SpriteKit）

## 画面
- `BoardView`（メイン）: 盤面 + 液晶エリア + 保留 + 統計。開いている間だけ 60/120fps。
- `PresentationPlayerView`: 演出再生（通知・AlarmKit から遷移）。
- `SettingsView`: 閾値、ハンドル位置、KeepAlive、歩数換算、リセット。
- `DebugView`（DEBUG ビルドのみ）: seed、時間倍率 x1/x10/x100、歩数注入、Atlas 照合結果、LA 更新ログ。

## 描画方針
- 盤面は起動時に JSON から `SKShapeNode` を焼いて1枚の `SKTexture` にする（釘数百本を毎フレーム描かない）。
- 玉: 画面を開いている間に `fired` された玉は `trajectory(canonicalParams, every: 4)` を事前計算し、
  `SKAction.follow` ではなく毎フレーム補間で動かす（時刻同期のため）。
- 開いた瞬間に「直近5秒間に発射済みで飛行中の玉」も途中から再生する → 常に打ち続けている見た目になる。
- 液晶エリアは `PachinkoPresentation` の縮小版シーンを埋め込む。

## 性能目標
- 同時 20 玉 + 液晶演出で 16e 上 60fps 維持（Instruments で確認）。
- 盤面を閉じたら SKView を paused にし、tick は Runtime の 1Hz のみ。
