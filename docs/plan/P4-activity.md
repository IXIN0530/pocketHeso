# P4 Activity: 受け取り台帳・ショートカット・チェックイン
T1〜T3 は P1〜P3 と並行可（`packages/claims` は Core の `Grant` 型だけに依存。型を先に core へ置く）。

### P4-T1 台帳と変換規則
Owner: Claude Code | Read: spec/30-activity-claims
Do: `ClaimRecord`・`ClaimRules`（economy json の claims 節）、累計差分方式、claimId 重複排除、受け取り可能日（今日＋2日）、
逓減・上限、streak（休養日パス含む）、`planGrants`。
Accept:
- [ ] 同じ日の歩数を 3000→8000→8000→7000 と3回同期して、報酬が 3000 分＋5000 分だけになるテスト
- [ ] streak と休養日パスのテスト

### P4-T2 ショートカットのコード
Owner: Claude Code | Read: spec/31-shortcut-health, spec/30-activity-claims（API 節）
Do: `parseShortcutCode`（形式・sig・鮮度・範囲）。P0-T3 で得た実機のコード例を fixture にする。
`resources/shortcut/README.md` を利用者向け手順として完成させる（iCloud リンクは人間が作成して記入）。
Accept:
- [ ] 実機由来 fixture 3件以上が通り、壊れたコード・別の鍵・古いコードがそれぞれ別のエラーになる

### P4-T3 チェックイン判定
Owner: Claude Code | Read: spec/32-training-checkin
Do: 範囲判定（登録地点・YOLP 業種別半径、accuracy 加味）、セッションの開始/終了/失効、報酬の判定表、YOLP 応答のパース（fixture、同一 Gid の重複まとめ）。
Accept:
- [x] 判定表の各行をテストで網羅（成立・20分未満・範囲外・失効・登録地点の初成立。後からボーナスは D-022 で廃止）

### P4-T4 ブラウザ側の配線
Owner: Claude Code | Read: spec/31-shortcut-health（利用者の流れ）, spec/32-training-checkin（流れ・施設の候補）, spec/41-pwa-platform（OS 連携節）
Do: `platform/{shortcut,clipboard,geo,yolp}.ts`（YOLP は JSONP・保存しない・2回制限、クレジット表示）、ペアリング鍵生成、
行動画面と受け取り確認モーダル（P5 の画面枠が未完なら最小 UI）。
Accept:
- [ ] 実機で「運動を受け取る」→ 燃料が増える、「トレーニング開始→20分後に終了」→ 燃料とメダルが増える（人間が確認し Notes へ）
