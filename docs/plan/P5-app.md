# P5 App: 画面・描画・保存
前提: P2-T5 完了（P3 未完の間は EconomyPort の仮実装で進めてよい）。

### P5-T0 描画担当の比較（Opus 5.5 vs Muse Spark 1.3）
Owner: 人間（進行）＋両エージェント | Read: ref/graphics-bakeoff
Do: ref/graphics-bakeoff の手順で、同じ課題（`?spike=bakeoff`）を `bakeoff/opus` と `bakeoff/muse` で作らせ、実機で伏せて見比べる。
Accept:
- [ ] 両ブランチのプレビュー URL が実機で開け、評価表が埋まっている（STATUS Notes に要約）
- [ ] P5-T2・P5-T3・P6-T2 の Owner を決め、DECISIONS に1行、tooling.md の分担表を更新

### P5-T1 Engine Worker と保存
Owner: Claude Code | Read: spec/10-architecture（保存節）, spec/40-app-ui（状態管理節）, spec/41-pwa-platform（保存節）
Do: `engine.worker.ts`（RPC）、IndexedDB（idb）スキーマと版数移行、起動時の復元（snapshot 無しでも seed+claims+actions から再計算）、
presence 記録、時計巻き戻し検知、セーブの書き出し/読み込み。
Accept:
- [ ] 書き出し→全消去→読み込みで同じ Projection になるテスト
- [ ] snapshot を壊しても再計算で起動できるテスト

### P5-T2 盤面描画
Owner: Muse Spark | Read: spec/50-app-rendering, spec/20-core-physics（盤面 JSON 節）
Do: `<BoardCanvas>`（Three.js, spec/50）、盤面板のテクスチャ焼き込みと釘の InstancedMesh、役物の回転表示、玉の軌跡再生（途中から再生を含む）。
P0-T6 の `spikes/three-board.ts` の質感設定を流用してよい。
Accept:
- [ ] ヘソに入った玉の描画終点がヘソセンサー内（軌跡末尾の自動テスト）/ Debug の x60 で破綻しない

### P5-T3 ホール・液晶・HUD
Owner: Muse Spark | Read: spec/40-app-ui（画面節）, spec/21-core-lottery（流れ節）
Do: 簡易図柄変動（3列）、保留（色＋形）、HUD、打つトグルとレート選択、予告の表示とタップ。演出は P6 で差し替える最小版。
Accept:
- [ ] 保留が増減し、変動と連動して正しく消化される

### P5-T4 強化・記録・設定・留守中サマリー
Owner: Claude Code | Read: spec/40-app-ui, spec/23-core-economy（役物・強化節）
Do: 強化画面（まとめ買い・覚醒・閉店）、記録画面、設定画面、留守中サマリーモーダル、数値の日本語表記、Debug 画面。
Accept:
- [ ] Debug の x3600 で「燃料付与→放置→復帰サマリー→購入」が一通り動く
- [ ] 実機 16e でブルーム OFF 時 60fps、10分連続で fps が落ちない（Safari Web インスペクタのタイムラインを `logs/` に）
