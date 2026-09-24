# P1 Core: RNG / Board / Physics
すべて `Packages/PachinkoCore`。UI 系 import 禁止。各タスクでテストを先に書く。

### P1-T1 数学・乱数
Owner: Muse Spark | Read: ref/conventions, spec/21-core-lottery（乱数ストリーム節のみ）
Do: `Vec2`（Double）、`SplitMix64`（シード展開）、`Xoshiro256StarStar`、`RNGStream(seed:id:index:)`、
`RNGStreamID` enum、`nextUInt32()` `nextUnit()`（[0,1)、53bit）、`pick(weights:)`。
Accept:
- [ ] 既知のテストベクタ（SplitMix64 seed=0 の先頭5値など）と一致
- [ ] 異なる id/index のストリームが独立（先頭100値の重複なし程度の検査）

### P1-T2 盤面モデルとローダー
Owner: Muse Spark | Read: spec/20-core-physics
Do: `Board` 型、JSON デコード、検証（範囲外・重複・センサー欠如）、正規化 JSON と SHA256 盤面ハッシュ、
`launch_dirs` テーブル生成（生成時のみ sin/cos 可。**実行時は表参照**）。
`Resources/boards/default.json` を作成（釘は格子＋ヘソ周りの寄り釘を手配置、約300本）。
Accept:
- [ ] default.json がロード・検証を通る
- [ ] 同じ内容でキー順が違う JSON のハッシュが一致

### P1-T3 物理ステップ
Owner: Muse Spark | Read: spec/20-core-physics
Do: 固定 dt、円-円/円-線分衝突、押し戻し＋反発＋摩擦、速度クランプ、グリッド・ブロードフェーズ、センサー判定、
タイムアウト。`BallSimulator.run(_:)`。
Accept:
- [ ] 単体テスト: 水平面で静止、斜面を転がる、釘1本で反射角が妥当
- [ ] 全玉がいずれかのセンサーかタイムアウトで終了する（1万発で確認）

### P1-T4 軌跡 API
Owner: Muse Spark | Read: spec/20-core-physics（API 節）
Do: `trajectory(_:every:)`。`run` と同一の内部ステップ関数を共有して実装する（コピペ禁止）。
Accept:
- [ ] 1万ケースで `run` と `trajectory` の kind・steps が一致

### P1-T5 決定論と性能
Owner: Muse Spark | Read: ref/conventions（テスト節）
Do: ゴールデンハッシュテスト（固定 1,000 LaunchParams の結果列）。ベンチ（`swift test` の `.timeLimit` か pachisim `bench`）。
Accept:
- [ ] ゴールデン固定
- [ ] 2,000発/秒以上（M 系 Mac, release）。未達なら Blockers に計測値を書く
