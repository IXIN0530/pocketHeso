# 50 App Rendering（Three.js）
（D-026 で PixiJS から Three.js に全面移行。実測と試作は P0-T6 `?spike=three`、`apps/web/src/spikes/three-board.ts`）

## 構成
- React コンポーネント `<BoardCanvas>` の中で Three の `WebGLRenderer`・`Scene`・カメラを命令的に保持する
  （@react-three/fiber は使わない。毎フレームの React 再レンダーを避けるため）。Projection の変化は ref 経由で渡す。
- ループは `renderer.setAnimationLoop`。背面タブ・非表示時は `setAnimationLoop(null)`。
- 座標: 盤面 JSON（spec/20）の座標をそのまま z=0 の平面に置く（単位 ≒ mm）。y 軸の向きの変換は1か所の関数に閉じる。
- 奥行き（z）: 盤面板 0 → 液晶 +3 → 玉・釘 +7 → 役物 +8 → ガラス +16 → 枠 +10〜+35（ボタン・ハンドルは +55 まで張り出す, D-061）。
- カメラ: `PerspectiveCamera`（fov 30）で正面からわずかに見上げる。枠込みの盤面が縦横どちらにも収まる距離を resize 時に計算。
- HUD・保留・ボタンは DOM（React）を canvas の上に重ねる。3D に入れない。

## 質感（外部素材なしが基本）
- 環境光は `RoomEnvironment` を PMREM に通した環境マップ（`environmentIntensity` 0.6）。トーンマップは ACES。
  筐体の材質だけは照明の帯を置いた専用の環境マップ（`bakeCabinetEnv`, D-062）で、つやのある樹脂に見せる。
- 素材: 玉 = 金属（metalness 1, roughness 0.08）/ 釘 = 真鍮 / 役物 = 金属 / 盤面板 = つや消し（roughness 0.85）。
  盤面板のつやを上げると天井照明の映り込みで白く飛ぶ（P0-T6 で確認）。
- ガラス: 黒の加算合成で鏡面の映り込みだけを足す（`envMapIntensity` 0.25）。透明マテリアルで白く曇らせない。
- 外部のモデル・HDR・テクスチャを使う場合は CC0 など再配布可能なものに限り、出典を `resources/CREDITS.md` に書く。

## 描画方針
- **盤面板**は起動時に盤面 JSON から Canvas 2D で描き、1枚のテクスチャに焼く。
- **釘**は `InstancedMesh` 1つ（数百本で draw call 1）。
- **役物**: 盤面 JSON の `yakumono` 座標に置き、spec/23 の `periodS` で実際に回す（位相は Projection の値から計算）。
  1周ごとに小さな「+玉数」のポップ。未解放の役物は暗く表示。
- **玉**: 前面で `fired` された玉は `trajectory(canonicalParams, 4)` を事前計算して毎フレーム補間。
  開いた瞬間に直近5秒以内に発射された飛行中の玉も途中から再生（打ち続けている見た目になる）。
  ジオメトリとマテリアルは全玉で共有。同時 50 玉を超える演出が要る時は `InstancedMesh` に切り替える。
- **液晶**: `packages/fx` の演出シーン（3列図柄＋リーチ演出）を、正射影カメラの別シーンで `WebGLRenderTarget` に描き、
  盤面の液晶メッシュのテクスチャにする。図柄・文字は事前生成のテクスチャアトラスを使い、毎フレームの Canvas 再描画はしない。
- **枠（筐体）**: 形は Claude Design の図（D-061）の座標 mm をそのまま押し出す（`spikes/bakeoff-cabinet.ts`）。
  枠ランプは点ではなく線の LED（Tube を結合＋流れる光のシェーダー1つ）。色を CueSheet・状態で変える。
- **ブルーム**（`UnrealBloomPass`、しきい値 2.5 で LED・発光部だけを光らせる。白い枠が飛ばない値, D-061）は**常時使わない**。
  16e で約 60→40fps に落ちるため、CueSheet の `bloom` キュー（spec/43）で激熱演出・当たり確定の瞬間など数秒だけ ON にする。
- **カメラワーク**: リーチ等の寄り・引きは CueSheet の `camera` キューで行い、終わったら必ず定位置に戻す。
- **FlashLayer**（spec/43）: 全画面クアッドをクリップ空間に直接描く加算シェーダ（虹・白フラッシュ）。最前面（`renderOrder`）。

## 性能目標
- iPhone 16e のホーム画面アプリで、ブルーム OFF の通常時に 同時 20 玉＋役物8＋液晶演出＋枠ランプ＋全画面の虹が 60fps
  （P0-T6 実測: pixelRatio 1〜3 のどれでも達成）。ブルーム ON 中は 40fps 以上を許容する（数秒に限るため）。
- pixelRatio は `min(devicePixelRatio, 3)`。10分連続で fps が落ちる（発熱）なら 2 に下げる（P5-T4 で計測）。
- 通常時の draw call は 150 以下を目安（P0-T6 の台で約 100）。
- 初回ロード（キャッシュなし）: JS 本体 gzip 300KB 以下（Three.js 一式で約 144KB）＋ Atlas 450KB。
  2回目以降は SW キャッシュで即起動。three は名前付き import のみ（`import * as THREE` を使わない）。
