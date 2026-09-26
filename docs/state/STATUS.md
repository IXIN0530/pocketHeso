# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P4 → `docs/plan/P4-activity.md`
- Last done: [P4-T4] ブラウザ側の配線（D-058、実装・テストまで。実機確認待ち）
- Next: P4-T4 の実機確認（人間）→ 通れば P5-T1 Engine Worker と保存（Current phase を P5 へ）
- Owner hint: Claude Code

## Blockers
- P4-T4 Accept（実機で運動を受け取る→燃料増／20分トレーニング→燃料とメダル増）が人間の確認待ち
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P4-T4 (D-058): apps/web に platform/{storage(idb, 6 store),shortcut(鍵生成・起動URL),clipboard,geo,yolp(JSONP・2回制限・クレジット)} と screens/{activity-screen,shortcut-panel,checkin-panel,confirm-modal}、stores/activity（計画・集計）。本体トップに行動画面（受け取った燃料＝grant 合計、Engine 投入は P5）。spike の yolp.ts/geo-range.ts を削除し geo spike は claims+platform に移行。YOLP ID は VITE_YOLP_APPID（未設定なら spike: geo で入れた端末の ID）。fake-indexeddb で台帳の追記のみ・セッション同時確定をテスト。build/all 通過。
- P4-T3 (D-057): claims/checkin に距離（正距円筒）・候補（半径+accuracy、近い順）・registerPlace・start/endSession・sessionState（3h失効）・selfCheckin（≤60分・≤経過）・parseYolp（重複 Gid まとめ、エラーは null）。planGrants に selfReported（source self・連続日数に数えない）と登録地点初成立メダル（placeBonus、持ち越し）。default.json checkin に min_minutes/self_max_minutes（Core 未使用で golden 不変）。YOLP fixture は公開仕様形式の合成（実応答は P4-T4 の実機で採取して差し替え可）。spike の yolp.ts/geo-range.ts は P4-T4 で claims に置き換える。core/build/all 通過。実機確認不要。
- P4-T2 (D-056): 実機 fixture 3件（09-24 17:13 / 09-26 14:51 / 09-26 15:04、いずれも署名一致）。3件を順に planGrants に通し、累計差分だけが入ることもテスト。claims に parseShortcutCode・同期 SHA-256（node:crypto と一致テスト）・ClaimError（format/version/signature/stale）。実機コード1件＋変種で3種のエラーが別になること・範囲外の破棄と警告・空値/改行/数字文字列の吸収をテスト。spike 画面に検証欄（鍵入力つき）。resources/shortcut/README.md を利用者向け（初回・毎回・エラー表）＋作者向け（読み込み時の質問・iCloud リンク作成）に再構成。iCloud リンクは未作成。core/build/all 通過。
