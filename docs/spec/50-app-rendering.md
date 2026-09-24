# 50 App Rendering（PixiJS）
（旧 native-v1 spec/50 の SpriteKit 方針を PixiJS v8 に移植）

## 構成
- React コンポーネント `<BoardCanvas>` の中で Pixi の `Application` を命令的に保持する（@pixi/react は使わない。
  毎フレームの React 再レンダーを避けるため）。Projection の変化は ref 経由で Pixi に渡す。
- レイヤー: 盤面（静的テクスチャ）→ 役物 → 玉 → 液晶エリア → 保留・HUD オーバーレイ → FlashLayer（spec/43）。

## 描画方針
- 盤面は起動時に JSON から `Graphics` で描き、1枚の `RenderTexture` に焼く（釘数百本を毎フレーム描かない）。
- **役物**: 盤面 JSON の `yakumono` 座標に置き、spec/23 の `periodS` で実際に回す（位相は Projection の値から計算）。
  1周ごとに小さな「+玉数」のポップ。未解放の役物は暗く表示。
- **玉**: 前面で `fired` された玉は `trajectory(canonicalParams, 4)` を事前計算して毎フレーム補間。
  開いた瞬間に直近5秒以内に発射された飛行中の玉も途中から再生（打ち続けている見た目になる）。
- 液晶エリア: `packages/fx` の演出シーン（3列図柄＋リーチ演出）。演出は CueSheet で駆動。
- 背面タブ・非表示時は `ticker.stop()`。

## 性能目標
- iPhone 16e の Safari（ホーム画面アプリ）で、同時 20 玉＋役物8＋液晶演出＋全画面の虹フラッシュが 60fps。
- 初回ロード（キャッシュなし）: JS 本体 gzip 300KB 以下＋ Atlas 450KB。2回目以降は SW キャッシュで即起動。
