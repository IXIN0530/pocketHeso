# P1 Core: RNG / Board / Physics
すべて `packages/core`。DOM・React・Pixi の import 禁止。各タスクでテストを先に書く。

### P1-T1 数学・乱数
Owner: Muse Spark | Read: ref/conventions, spec/21-core-lottery（乱数節のみ）
Do: `Vec2`（number, 破壊的更新しない）、`splitmix32`、`xoshiro128ss`、`RNGStream(seed, id, index)`、
`RNGStreamID`、`nextU32()` `nextUnit()` `pick(weights)`、ストリーム初期化用ハッシュ（FNV-1a 32bit 等、仕様をテストに固定）。
Accept:
- [ ] 公開テストベクタ（xoshiro128** の既知出力）と一致
- [ ] 異なる id/index のストリームが独立（先頭100値の重複なし程度）

### P1-T2 盤面モデルとローダー
Owner: Muse Spark | Read: spec/20-core-physics
Do: `Board` 型、JSON 検証（範囲外・重複・センサー欠如）、正規化 JSON と SHA-256 盤面ハッシュ（ハッシュ関数は引数で注入:
Node/ブラウザ両対応）、`launch_dirs` 表（**生成は pachisim 側で sin/cos 可**、Core は表を読むだけ）。
`resources/boards/default.json`（釘 約300本、ヘソ周りの寄り釘、役物座標8つ）。
Accept:
- [ ] default.json がロード・検証を通る / キー順違いの JSON でハッシュが一致

### P1-T3 物理ステップ
Owner: Muse Spark | Read: spec/20-core-physics
Do: 固定 dt、円-円/円-線分衝突、押し戻し＋反発＋摩擦、速度クランプ、グリッド・ブロードフェーズ（型付き配列）、センサー、タイムアウト。`BallSimulator.run`。
Accept:
- [ ] 単体テスト: 水平面で静止、斜面を転がる、釘1本で反射角が妥当
- [ ] 1万発すべてがセンサーかタイムアウトで終了

### P1-T4 軌跡 API
Owner: Muse Spark | Read: spec/20-core-physics（API 節）
Do: `trajectory(p, every)`。`run` と内部ステップ関数を共有（コピペ禁止）。
Accept:
- [ ] 1万ケースで `run` と `trajectory` の kind・steps が一致

### P1-T5 決定論と性能
Owner: Muse Spark | Read: ref/conventions（テスト節）
Do: ゴールデンハッシュ（固定 1,000 LaunchParams）。ベンチ `pnpm sim bench`。
Accept:
- [ ] ゴールデン固定。Node と（P5 以降に）ブラウザで同じハッシュになる前提のテストを用意
- [ ] Node 単スレッドで 2,000発/秒以上。未達なら Blockers に計測値
