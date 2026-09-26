# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P5 → `docs/plan/P5-app.md`
- Last done: P5-T2 盤面描画（BoardCanvas・Engine の玉の再生・役物の回転・Debug x60, D-063）
- Next: 人間が実機で P5-T2 を確認 → P5-T3 ホール・液晶・HUD
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P5-T2 (D-063): `apps/web/src/board/`（board-scene・ball-tracks・board-canvas、スパイクの art/cabinet/lcd を移設）。本体トップに盤面を遅延読み込みで表示。玉は Engine の Shot（Worker が fired/sensor＋Core の新 `inFlight()` から作る）を「時計−1.3秒×倍率」で再生、釘強化の out→start1 はヘソ行きの軌跡に差し替え。役物は YakumonoView.periodS（Core に追加）で回し、未解放は暗い。`?debug=1` で fps/calls、`&x=60|3600` で時間倍率（別 DB）。仮の「打つ/止める」ボタンあり。ヘッドレス Chrome で x1・x60 とも 60fps・約 34 draw call。未: 役物1周ごとの「+玉数」（Projection に1周の玉数が無い）、液晶の保留は盤面のヘソ入賞で仮に増やしている（P5-T3 で Projection に）。`?spike=bakeoff` は本番シーン＋デモの玉。
- DESIGN (D-061): 参考画像（`images/`、市販機の写真なのでコミットしない）から共通点を抽出し Claude Design で図を作成（https://claude.ai/artifact/QfX1K7XU3ZiXdEL41uCsCg: 共通点の分析・採用案 A パール×バイオレット・配色3案・iPhone 表示・部品と実装の対応）。`board/cabinet.ts`（旧 spikes/bakeoff-cabinet.ts）に図の座標 mm をそのまま押し出して実装（翼・HESO コアのエンブレム・ロゴ帯・線の LED・V 字の下部と PUSH ボタン・スピーカー・ハンドル）。盤面の絵・液晶の額縁・役物の色も合わせた（釘・ヘソ・位置は不変）。ブルームしきい値 2.5。配色は `PALETTES` で切替。通常 42 / 当たり中 56 draw call（ヘッドレス Chrome）。9/26 のコメント（白が CG っぽい・下部の質感）を受けて D-062 で質感を修正（色と光り方は据え置き）。実機で演出まで確認済み 09-26。
- P5-T0 (D-060): 同じ課題を bakeoff/opus・bakeoff/muse で作り、人間が実機で比較して Opus が明らかに上と判断（評価表の数値は省略）。P5-T2・P5-T3・P6-T2 と台まわりの UI・演出は Claude Code。bakeoff/opus（e0ab2fc: 筐体・LED 枠ランプ・シェーダーの液晶図柄と保留・BallSimulator の軌跡再生・虹フラッシュ＋ブルーム3秒、通常時 約45 draw call）を dev に早送りマージ。演出中の fps は実機で未計測（P5-T2/T4 で測る）。比較用ブランチ2本は削除済み（Muse の成果は 0f5b934 として reflog のみ）。
