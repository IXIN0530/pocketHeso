# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P5 → `docs/plan/P5-app.md`
- Last done: P5-T3 ホール・液晶・HUD（イベント再生の保留と図柄・HUD・打つトグル・レート・予告, D-064）
- Next: 人間が実機で P5-T2・P5-T3 を確認 → P5-T4 強化・記録・設定・留守中サマリー
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P5-T3 (D-064): `screens/hall-screen.tsx`（盤面＋HUD 持ち玉/メダル/燃料/生産・モード/回転/大当たり・打つトグル・レート（解放2段目から表示）・予告ボタン）。液晶は `board/lcd-timeline.ts` で Engine のイベントを表示時刻で再生（保留は色＋形: 白青=丸・緑=ひし形・赤=星4・金=星5、当該保留は中央下）。リーチは左右を早めに揃えて中を終了時刻まで回す。大当たり開始で当たり演出。仮の打つボタンは削除。ヘッドレス Chrome x1 で 60fps・約34 draw call、リーチと保留を目視。`?spike=bakeoff` の液晶は Engine が無いので回らない（当たり演出のタップは可）。初期の持ち玉100は約1分で尽きる（Lv0 は生産0）ので、実機で長く見るには燃料＋強化が要る（P5-T4）。
- P5-T2 (D-063): `apps/web/src/board/`（board-scene・ball-tracks・board-canvas、スパイクの art/cabinet/lcd を移設）。本体トップに盤面を遅延読み込みで表示。玉は Engine の Shot（Worker が fired/sensor＋Core の新 `inFlight()` から作る）を「時計−1.3秒×倍率」で再生、釘強化の out→start1 はヘソ行きの軌跡に差し替え。役物は YakumonoView.periodS（Core に追加）で回し、未解放は暗い。`?debug=1` で fps/calls、`&x=60|3600` で時間倍率（別 DB）。仮の「打つ/止める」ボタンあり。ヘッドレス Chrome で x1・x60 とも 60fps・約 34 draw call。未: 役物1周ごとの「+玉数」（Projection に1周の玉数が無い）、液晶の保留は盤面のヘソ入賞で仮に増やしている（P5-T3 で Projection に）。`?spike=bakeoff` は本番シーン＋デモの玉。
- DESIGN (D-061): 参考画像（`images/`、市販機の写真なのでコミットしない）から共通点を抽出し Claude Design で図を作成（https://claude.ai/artifact/QfX1K7XU3ZiXdEL41uCsCg: 共通点の分析・採用案 A パール×バイオレット・配色3案・iPhone 表示・部品と実装の対応）。`board/cabinet.ts`（旧 spikes/bakeoff-cabinet.ts）に図の座標 mm をそのまま押し出して実装（翼・HESO コアのエンブレム・ロゴ帯・線の LED・V 字の下部と PUSH ボタン・スピーカー・ハンドル）。盤面の絵・液晶の額縁・役物の色も合わせた（釘・ヘソ・位置は不変）。ブルームしきい値 2.5。配色は `PALETTES` で切替。通常 42 / 当たり中 56 draw call（ヘッドレス Chrome）。9/26 のコメント（白が CG っぽい・下部の質感）を受けて D-062 で質感を修正（色と光り方は据え置き）。実機で演出まで確認済み 09-26。
