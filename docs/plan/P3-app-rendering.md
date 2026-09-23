# P3 App Rendering
前提: P2-T5 完了。Runtime（P4）とは疎結合にし、P3 では **ローカルの Engine を直接回す開発用モード** で描画する。

### P3-T1 盤面描画
Owner: Muse Spark | Read: spec/50-app-rendering, spec/20-core-physics（盤面 JSON 節）
Do: JSON → `SKShapeNode` → 1枚のテクスチャに焼き込み。ヘソ・アウトの強調表示。
Accept:
- [ ] シミュレーターで盤面が表示される（スクリーンショットを `logs/` に保存）

### P3-T2 玉の再生
Owner: Muse Spark | Read: spec/50-app-rendering, spec/22-core-events（fired/sensor）
Do: `fired` イベント → `trajectory` 事前計算 → 毎フレーム補間。開いた瞬間に飛行中の玉を途中から再生。
Accept:
- [ ] ヘソに入った玉の描画終点がヘソセンサー内（自動テスト: 軌跡末尾座標を検証）
- [ ] DebugView の x10 倍速で破綻しない

### P3-T3 液晶エリア・保留・HUD
Owner: Muse Spark | Read: spec/50-app-rendering, spec/21-core-lottery（流れ節）
Do: 簡易図柄変動（3列の数字）、保留4つ（色）、モード・統計表示。演出は P6 で差し替える前提の最小版。
Accept:
- [ ] 保留が増減し、変動と連動して正しく消化される

### P3-T4 DebugView と設定画面の骨組み
Owner: Muse Spark | Read: spec/50-app-rendering（画面節）
Accept:
- [ ] seed 変更・時間倍率・歩数注入が機能する
- [ ] 実機 16e で 20玉同時 60fps（Instruments のスクリーンショットを `logs/`）
