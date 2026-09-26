# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P5 → `docs/plan/P5-app.md`
- Last done: [P5-T1] Engine Worker と保存（D-059）
- Next: P5-T0 描画担当の比較（人間進行）→ P5-T2 盤面描画
- Owner hint: 人間（P5-T0 進行）

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P5-T1 (D-059): core に EngineConfig.startMs。apps/web に engine.worker.ts（RPC は engine/rpc.ts、呼び出しは直列）、engine/{engine-host,engine-build,game-config}、platform/save-file（PH-SAVE1 gzip+base64、壊れたセーブは DB を変えない）、storage に meta 版2移行・ActionLog・snapshot（latest＋日毎7件、前面60秒ごと・背面時・起動時に保存）。受け取りは Worker 経由で台帳追記。stores/engine（Zustand）が 1Hz tick と visibilitychange→presence。最小表示: 燃料の残り・メダル（Engine 値）、持ち玉、時計巻き戻し警告、留守中サマリー、セーブ欄。Accept テスト2件＋移行・巻き戻し・失敗時の巻き戻し・RPC。build/all/core 通過。実機スモーク（燃料・メダル移行、受け取り、留守中サマリー、セーブ書き出し/読み込み）手動確認済み 09-26。
- P4-T4 (D-058): apps/web に platform/{storage(idb, 6 store),shortcut(鍵生成・起動URL),clipboard,geo,yolp(JSONP・2回制限・クレジット)} と screens/{activity-screen,shortcut-panel,checkin-panel,confirm-modal}、stores/activity（計画・集計）。本体トップに行動画面（受け取った燃料＝grant 合計、Engine 投入は P5）。spike の yolp.ts/geo-range.ts を削除し geo spike は claims+platform に移行。YOLP ID は VITE_YOLP_APPID（未設定なら spike: geo で入れた端末の ID）。fake-indexeddb で台帳の追記のみ・セッション同時確定をテスト。build/all 通過。実機（運動の受け取り・20分トレーニング）手動確認済み 09-26。
- P4-T3 (D-057): claims/checkin に距離（正距円筒）・候補（半径+accuracy、近い順）・registerPlace・start/endSession・sessionState（3h失効）・selfCheckin（≤60分・≤経過）・parseYolp（重複 Gid まとめ、エラーは null）。planGrants に selfReported（source self・連続日数に数えない）と登録地点初成立メダル（placeBonus、持ち越し）。default.json checkin に min_minutes/self_max_minutes（Core 未使用で golden 不変）。YOLP fixture は公開仕様形式の合成（実応答は P4-T4 の実機で採取して差し替え可）。spike の yolp.ts/geo-range.ts は P4-T4 で claims に置き換える。core/build/all 通過。実機確認不要。
