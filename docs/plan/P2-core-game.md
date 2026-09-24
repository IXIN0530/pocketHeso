# P2 Core: Atlas / Lottery / Engine（パチンコ部）/ pachisim
前提: P1 完了。Claude Code は P2-T5 と P2-T6 をレビューする。

### P2-T1 機種仕様
Owner: Muse Spark | Read: spec/21-core-lottery
Do: `MachineSpec`・`PatternTable` 型、JSON ロードと検証、uint32 閾値変換。
`resources/machines/light-middle-01.json` と `patterns.json`。
Accept:
- [ ] 1/199.8 の閾値が期待値と一致するテスト

### P2-T2 Outcome Atlas
Owner: Muse Spark | Read: spec/20-core-physics（Atlas 節）
Do: キー量子化、生成（Node worker_threads 並列可、**結果は並列度に依存しない**）、バイナリ形式（ヘッダ: 版数・盤面ハッシュ・件数）、
読み込み（`ArrayBuffer`→`DataView`）、`verify(prefix)`。`pnpm sim atlas --board default`。
Accept:
- [ ] 1スレッドと並列でバイナリ完全一致 / `resources/atlas/default.<hash16>.bin` 約450KB
- [ ] ヘソ入賞率を出力（目標 5〜8%。外れたら盤面調整か Blockers）

### P2-T3 抽選と保留
Owner: Muse Spark | Read: spec/21-core-lottery
Do: 取得時判定（当否・振分け・パターン・色, D-017）、賞球、保留キュー（hold_max 可変・overflow）、モード判定、レート倍率。
Accept:
- [ ] 100万取得で当選率が 1/199.8 ± 3σ（ST も同様）/ 保留色の出現比が重みどおり（カイ二乗 p > 0.01）

### P2-T4 変動・大当たり・モード状態機械
Owner: Muse Spark | Read: spec/21-core-lottery, spec/22-core-engine（イベント節）
Do: 変動開始/停止、大当たり（時間消化）、ST 回数、`modeChanged`、メダル付与。
Accept:
- [ ] 手書きシナリオ（保留4満タン→順次消化→当たり→ST→ST抜け）が期待イベント列と一致

### P2-T5 Engine（パチンコ部）
Owner: Muse Spark（Review: Claude Code）| Read: spec/22-core-engine
Do: 入力列（Action の `shoot`/`auto`/`presence` のみ先に）、600ms 発射グリッド、持ち玉消費、Atlas 参照、`advance`、
`snapshot`/`restore`、`lookahead`、`project`（パチンコ部の項目）。経済は P3 で差し込むため `EconomyPort` インターフェースで仮実装。
Accept:
- [ ] 決定論契約 1・2（spec/22）をテスト / 放置8時間のオート打ち `advance` が Node で 100ms 以内

### P2-T6 pachisim レポート
Owner: Muse Spark（Review: Claude Code）| Read: spec/21-core-lottery
Do: `pnpm sim run --balls 10000000 --seed N [--json]` → 回転率/1000発、初当たり確率、ST 継続率、平均出玉、最大ハマり、1玉あたり払い戻し。
Accept:
- [ ] 理論値と観測値を並べた表を出し、許容差内であることをテストで確認
