# P2 Core: Atlas / Lottery / Engine / pachisim
前提: P1 完了。Claude Code は P2-T5 と P2-T6 をレビューする。

### P2-T1 機種仕様
Owner: Muse Spark | Read: spec/21-core-lottery
Do: `MachineSpec`・`PatternTable` 型、JSON ロード、確率を UInt32 閾値へ変換、検証。
`Resources/machines/light-middle-01.json` と `patterns.json` を作成。
Accept:
- [ ] ロードと検証のテスト。1/199.8 の閾値が期待値と一致

### P2-T2 Outcome Atlas
Owner: Muse Spark | Read: spec/20-core-physics（Atlas 節）
Do: キー量子化、`OutcomeAtlas` 生成（macOS では並列可。**生成結果は並列度に依存しない**こと）、
バイナリ形式（ヘッダに版数・盤面ハッシュ・エントリ数）、読み込み、部分照合 API `verify(prefix:)`。
`pachisim atlas --board default`。
Accept:
- [ ] 1スレッド生成と並列生成でバイナリが完全一致
- [ ] `Resources/atlas/default.<hash16>.bin` 生成、サイズ 500KB 前後
- [ ] ヘソ入賞率を出力（目標 5〜8%。外れたら盤面を調整するか Blockers へ）

### P2-T3 抽選と保留
Owner: Muse Spark | Read: spec/21-core-lottery
Do: 取得時判定（当否・振分け・パターン・色）、保留キュー（最大4・overflow）、モード判定。
MVP 簡略（取得時モードで判定）を DECISIONS に D-007 として記録。
Accept:
- [ ] 100万取得で当選率が 1/199.8 ± 3σ に収まる（ST モードも同様）
- [ ] 保留色の出現比が重みどおり（カイ二乗で p > 0.01）

### P2-T4 変動・大当たり・モード状態機械
Owner: Muse Spark | Read: spec/21-core-lottery, spec/22-core-events（SimEvent 節）
Do: 変動開始/停止、大当たり（時間経過で消化）、ST 回数管理、`modeChanged`。
Accept:
- [ ] 手書きシナリオテスト（保留4満タン→順次消化→当たり→ST→ST抜け）が期待イベント列と一致

### P2-T5 Engine
Owner: Muse Spark（Review: Claude Code）| Read: spec/22-core-events
Do: `InputLedger`、クレジット→発射スケジュール、Atlas 参照、`advance(to:)`、`snapshot`/復元、`lookahead`、
`project` / `projectTimeline`。
Accept:
- [ ] 決定論契約 1〜3（spec 22）すべてテスト済み
- [ ] `SurfaceProjection` の JSON が 1KB 以下（最大状態で測定）
- [ ] 8時間分（約48,000歩）の `advance` が M 系 Mac で 200ms 以内

### P2-T6 pachisim レポート
Owner: Muse Spark（Review: Claude Code）| Read: spec/21-core-lottery
Do: `pachisim run --steps 10000000 --seed N` → 回転率/1000発、初当たり確率、ST 継続率、平均出玉、最大ハマり。
`--json` 出力。
Accept:
- [ ] 理論値と観測値を並べた表を出力し、許容差内であることをテストで確認
