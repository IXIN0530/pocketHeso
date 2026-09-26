# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P5 → `docs/plan/P5-app.md`
- Last done: [P5-T0] 描画担当の比較 → Opus 5.5（Claude Code）に決定（D-060）
- Next: P5-T2 盤面描画（`spikes/bakeoff-*.ts` を土台に `<BoardCanvas>` へ）
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P5-T0 (D-060): 同じ課題を bakeoff/opus・bakeoff/muse で作り、人間が実機で比較して Opus が明らかに上と判断（評価表の数値は省略）。P5-T2・P5-T3・P6-T2 と台まわりの UI・演出は Claude Code。bakeoff/opus（e0ab2fc: 筐体・LED 枠ランプ・シェーダーの液晶図柄と保留・BallSimulator の軌跡再生・虹フラッシュ＋ブルーム3秒、通常時 約45 draw call）を dev に早送りマージ。演出中の fps は実機で未計測（P5-T2/T4 で測る）。比較用ブランチ2本は削除済み（Muse の成果は 0f5b934 として reflog のみ）。
- P5-T1 (D-059): core に EngineConfig.startMs。apps/web に engine.worker.ts（RPC は engine/rpc.ts、呼び出しは直列）、engine/{engine-host,engine-build,game-config}、platform/save-file（PH-SAVE1 gzip+base64、壊れたセーブは DB を変えない）、storage に meta 版2移行・ActionLog・snapshot（latest＋日毎7件、前面60秒ごと・背面時・起動時に保存）。受け取りは Worker 経由で台帳追記。stores/engine（Zustand）が 1Hz tick と visibilitychange→presence。最小表示: 燃料の残り・メダル（Engine 値）、持ち玉、時計巻き戻し警告、留守中サマリー、セーブ欄。Accept テスト2件＋移行・巻き戻し・失敗時の巻き戻し・RPC。build/all/core 通過。実機スモーク（燃料・メダル移行、受け取り、留守中サマリー、セーブ書き出し/読み込み）手動確認済み 09-26。
- P4-T4 (D-058): apps/web に platform/{storage(idb, 6 store),shortcut(鍵生成・起動URL),clipboard,geo,yolp(JSONP・2回制限・クレジット)} と screens/{activity-screen,shortcut-panel,checkin-panel,confirm-modal}、stores/activity（計画・集計）。本体トップに行動画面（受け取った燃料＝grant 合計、Engine 投入は P5）。spike の yolp.ts/geo-range.ts を削除し geo spike は claims+platform に移行。YOLP ID は VITE_YOLP_APPID（未設定なら spike: geo で入れた端末の ID）。fake-indexeddb で台帳の追記のみ・セッション同時確定をテスト。build/all 通過。実機（運動の受け取り・20分トレーニング）手動確認済み 09-26。
