# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P4 → `docs/plan/P4-activity.md`
- Last done: [P3-T6] 経済の再試算（sim列追加・新目標・default調整D-053・golden更新・27条件全OK）
- Next: P4-T1 台帳と変換規則
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P3-T6 (D-053): simに常連内訳・閉店履歴・玉内訳列と新目標判定（覚醒3-4日・フィーバー20-40%・28日3-5閉店・週次上昇・lt系EV下限0.7）。獲得0閉店の禁止・EV計測に燃料でT6申し送りを解消。defaultはフィーバー[4,5,6,8,11,16,21]・divisor1.2e10。golden→e6e133a9ca34219b（玉/経済のみ増、イベント列は不変）。27条件（3profile×3seed×3機種）全OK・core/build/all通過。実機確認不要。12週: 標準15P/heavy18P・閉店15/18回で週1継続・perSecが(1+P)超で鈍らず・heavy>standard・行動由来が上限。
- P3-T5 レビュー修正（D-052）: 持ち玉<rate で発射しない・留守中獲得玉を消費玉Σrateで補正（snapshot away.awayConsumed?）。golden 不変、core・build・all 通過。T6 申し送り: pachisim econ の EV=payout/fired は rate1 前提（rate>1 を試すなら分母を消費玉に）。
- P3-T5: 大当たりメダル廃止（機種JSONの medal 削除）・累計獲得メダル・燃料0でオート停止・常連P=min式・倍率1+1.0P・覚醒5×2^n・大当たりフィーバー（rate別 [3,4,5,7,10,15,20]）・1発rate玉/出玉×rate。golden→e395abf58ca17a5b（旧版比でイベント列は medals 欄以外全件一致、差はフィーバー分の玉+20,250・メダル-7・snapshot v3 のみ）。core・build・all通過。実機確認不要。T6 向け所見（仮値のsim standard 14日）: 貪欲戦略が獲得0でも閉店して退行する→獲得≥1の時だけ閉店させる／`--ev-hours` の EV 計測が燃料0でオート停止し 0.000 になる→計測に燃料を入れる／大当たりは約55→4回/日に減少。
