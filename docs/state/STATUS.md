# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P3（追加分）→ `docs/plan/P3-core-economy.md`（T5・T6 の後に P4）
- Last done: [P3-T5] 通貨分離・行動由来の転生・大当たりフィーバー（D-049〜D-051）＋レビュー修正（D-052）
- Next: P3-T6 経済の再試算 → P4-T1
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- P3-T5 レビュー修正（D-052）: 持ち玉<rate で発射しない・留守中獲得玉を消費玉Σrateで補正（snapshot away.awayConsumed?）。golden 不変、core・build・all 通過。T6 申し送り: pachisim econ の EV=payout/fired は rate1 前提（rate>1 を試すなら分母を消費玉に）。
- P3-T5: 大当たりメダル廃止（機種JSONの medal 削除）・累計獲得メダル・燃料0でオート停止・常連P=min式・倍率1+1.0P・覚醒5×2^n・大当たりフィーバー（rate別 [3,4,5,7,10,15,20]）・1発rate玉/出玉×rate。golden→e395abf58ca17a5b（旧版比でイベント列は medals 欄以外全件一致、差はフィーバー分の玉+20,250・メダル-7・snapshot v3 のみ）。core・build・all通過。実機確認不要。T6 向け所見（仮値のsim standard 14日）: 貪欲戦略が獲得0でも閉店して退行する→獲得≥1の時だけ閉店させる／`--ev-hours` の EV 計測が燃料0でオート停止し 0.000 になる→計測に燃料を入れる／大当たりは約55→4回/日に減少。
- 方針転換（D-049/050）: メダルは行動のみ・常連P=min(玉由来,行動由来)・倍率1+1.0P・燃料0でオート停止・覚醒5×2^n・大当たり価値は生産フィーバーへ（出玉は初日生産の0.25秒分しかないため）。P4-T1 は影響なし（累計獲得メダルは Core 側）。
