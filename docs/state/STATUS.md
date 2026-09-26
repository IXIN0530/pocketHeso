# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P3（追加分）→ `docs/plan/P3-core-economy.md`（T5・T6 の後に P4）
- Last done: 経済方針の転換（D-049・D-050、spec/00・21・22・23・30 更新、P3-T5/T6 追加）
- Next: P3-T5 通貨分離・行動由来の転生・大当たりフィーバー → P3-T6 再試算 → P4-T1
- Owner hint: Claude Code

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- 方針転換（D-049/050）: メダルは行動のみ・常連P=min(玉由来,行動由来)・倍率1+1.0P・燃料0でオート停止・覚醒5×2^n・大当たり価値は生産フィーバーへ（出玉は初日生産の0.25秒分しかないため）。P4-T1 は影響なし（累計獲得メダルは Core 側）。
- P3-T4: `pnpm sim econ --profile standard|none|heavy --days N [--seed/--machine/--economy/--ev-hours/--json]`（貪欲・レート1）。D-048で調整し目標3点OK（標準: クルーン1日目・覚醒3日目・初閉店7〜8日目(seed1〜3/3機種)、行動なし61日閉店なし、EV初期0.80〜0.85/全強化0.92〜0.99）。要人間判断: パチンコ由来メダル98%（オートは燃料0でも24h打てる）・spec/23本文は旧値のまま・rate>1はD-034のコスト1玉固定で有利。golden→fdc33df4b9110301。core・build・all通過。実機確認不要。
- P3-T3 レビュー修正: 経済tickをグリッド時刻で先払い（D-047）・予告出現時刻を nextEventTime に追加。不揃い刻み(1〜7777ms)vs1回の一致テスト追加、golden→09b9d3e3850ee32d（予告時刻の補正のみが原因と確認）。core・build通過。実機確認不要。
