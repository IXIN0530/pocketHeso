# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P4 → `docs/plan/P4-activity.md`
- Last done: [P4-T2] 実機 fixture を3件に（Accept 充足）／[P4-T3] チェックイン判定（D-057）
- Next: P4-T4 ブラウザ側の配線
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P4-T3 (D-057): claims/checkin に距離（正距円筒）・候補（半径+accuracy、近い順）・registerPlace・start/endSession・sessionState（3h失効）・selfCheckin（≤60分・≤経過）・parseYolp（重複 Gid まとめ、エラーは null）。planGrants に selfReported（source self・連続日数に数えない）と登録地点初成立メダル（placeBonus、持ち越し）。default.json checkin に min_minutes/self_max_minutes（Core 未使用で golden 不変）。YOLP fixture は公開仕様形式の合成（実応答は P4-T4 の実機で採取して差し替え可）。spike の yolp.ts/geo-range.ts は P4-T4 で claims に置き換える。core/build/all 通過。実機確認不要。
- P4-T2 (D-056): 実機 fixture 3件（09-24 17:13 / 09-26 14:51 / 09-26 15:04、いずれも署名一致）。3件を順に planGrants に通し、累計差分だけが入ることもテスト。claims に parseShortcutCode・同期 SHA-256（node:crypto と一致テスト）・ClaimError（format/version/signature/stale）。実機コード1件＋変種で3種のエラーが別になること・範囲外の破棄と警告・空値/改行/数字文字列の吸収をテスト。spike 画面に検証欄（鍵入力つき）。resources/shortcut/README.md を利用者向け（初回・毎回・エラー表）＋作者向け（読み込み時の質問・iCloud リンク作成）に再構成。iCloud リンクは未作成。core/build/all 通過。
- P4-T1 (D-055): claims に ClaimRecord/ClaimRules(parseClaimRules)/planGrants/streakOf と日付算術（Date 不使用）。default.json の claims 節に換算・逓減・trust・streak 閾値を追加（Core 未使用なので golden 不変）。休養日パスは rest 記録（燃料0・streakDay 付き）で Engine の連日数と一致をテストで確認。3000→8000→8000→7000 は 30分＋50分のみ。core/build/all 通過。実機確認不要。pachisim econ は独自の換算（stepsFuelMin 等）のままなので、将来 claims に寄せる余地あり。
