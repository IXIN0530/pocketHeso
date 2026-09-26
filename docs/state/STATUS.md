# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P5 → `docs/plan/P5-app.md`
- Last done: [DESIGN] 筐体（枠）の刷新（D-061）
- Next: 人間が実機で新しい筐体を確認 → P5-T2 盤面描画（`spikes/bakeoff-*.ts` を土台に `<BoardCanvas>` へ）
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- DESIGN (D-061): 参考画像（`images/`、市販機の写真なのでコミットしない）から共通点を抽出し Claude Design で図を作成（https://claude.ai/artifact/QfX1K7XU3ZiXdEL41uCsCg: 共通点の分析・採用案 A パール×バイオレット・配色3案・iPhone 表示・部品と実装の対応）。`spikes/bakeoff-cabinet.ts` に図の座標 mm をそのまま押し出して実装（翼・HESO コアのエンブレム・ロゴ帯・線の LED・V 字の下部と PUSH ボタン・スピーカー・ハンドル）。盤面の絵・液晶の額縁・役物の色も合わせた（釘・ヘソ・位置は不変）。ブルームしきい値 2.5。配色は `PALETTES` で切替。通常 42 / 当たり中 56 draw call（ヘッドレス Chrome）。実機の見た目・fps は未確認。
- P5-T0 (D-060): 同じ課題を bakeoff/opus・bakeoff/muse で作り、人間が実機で比較して Opus が明らかに上と判断（評価表の数値は省略）。P5-T2・P5-T3・P6-T2 と台まわりの UI・演出は Claude Code。bakeoff/opus（e0ab2fc: 筐体・LED 枠ランプ・シェーダーの液晶図柄と保留・BallSimulator の軌跡再生・虹フラッシュ＋ブルーム3秒、通常時 約45 draw call）を dev に早送りマージ。演出中の fps は実機で未計測（P5-T2/T4 で測る）。比較用ブランチ2本は削除済み（Muse の成果は 0f5b934 として reflog のみ）。
- P5-T1 (D-059): core に EngineConfig.startMs。apps/web に engine.worker.ts（RPC は engine/rpc.ts、呼び出しは直列）、engine/{engine-host,engine-build,game-config}、platform/save-file（PH-SAVE1 gzip+base64、壊れたセーブは DB を変えない）、storage に meta 版2移行・ActionLog・snapshot（latest＋日毎7件、前面60秒ごと・背面時・起動時に保存）。受け取りは Worker 経由で台帳追記。stores/engine（Zustand）が 1Hz tick と visibilitychange→presence。最小表示: 燃料の残り・メダル（Engine 値）、持ち玉、時計巻き戻し警告、留守中サマリー、セーブ欄。Accept テスト2件＋移行・巻き戻し・失敗時の巻き戻し・RPC。build/all/core 通過。実機スモーク（燃料・メダル移行、受け取り、留守中サマリー、セーブ書き出し/読み込み）手動確認済み 09-26。
