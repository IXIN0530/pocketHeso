# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P4 → `docs/plan/P4-activity.md`
- Last done: [P4-T1] 台帳と変換規則（planGrants・streakOf・休養日パス, D-055）
- Next: P4-T2 ショートカットのコード（実機由来 fixture が要る）
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P4-T1 (D-055): claims に ClaimRecord/ClaimRules(parseClaimRules)/planGrants/streakOf と日付算術（Date 不使用）。default.json の claims 節に換算・逓減・trust・streak 閾値を追加（Core 未使用なので golden 不変）。休養日パスは rest 記録（燃料0・streakDay 付き）で Engine の連日数と一致をテストで確認。3000→8000→8000→7000 は 30分＋50分のみ。core/build/all 通過。実機確認不要。pachisim econ は独自の換算（stepsFuelMin 等）のままなので、将来 claims に寄せる余地あり。
- P3-T6 レビュー修正 (D-054): sim のフィーバー内訳を区間内フィーバー tick 数で按分・週次役物を (最上位, Lv合計) 辞書順で判定・heavy は同条件 standard と常連P自動比較・lt EV下限0.7 の根拠を D-054/spec23 に記載・econ.test に按分/閉店履歴/玉内訳/判定行のテスト。正しい按分で rush seed3 が19.4%のため rate1 フィーバー 4→4.5（golden 3f67ce0cf12b88a7）。27条件全OK（標準フィーバー22.9〜35.2%・週次Lv合計は全seedで単調増・heavy 6P>standard 5P、12週 heavy18P>standard15P で D-053 と同じ）・core/build/all通過。実機確認不要。
- P3-T6 (D-053): simに常連内訳・閉店履歴・玉内訳列と新目標判定（覚醒3-4日・フィーバー20-40%・28日3-5閉店・週次上昇・lt系EV下限0.7）。獲得0閉店の禁止・EV計測に燃料でT6申し送りを解消。defaultはフィーバー[4,5,6,8,11,16,21]・divisor1.2e10。golden→e6e133a9ca34219b（玉/経済のみ増、イベント列は不変）。27条件（3profile×3seed×3機種）全OK・core/build/all通過。実機確認不要。12週: 標準15P/heavy18P・閉店15/18回で週1継続・perSecが(1+P)超で鈍らず・heavy>standard・行動由来が上限。
