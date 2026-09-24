# P7 Soak & Tune

### P7-T1 ローカル計測ログ
Owner: Claude Code | Read: spec/40-app-ui（Debug）
Do: 起動時の追いつき時間、Worker の advance 時間、IndexedDB サイズ、受け取り回数を `metrics` store に記録し Debug に表示。

### P7-T2 1週間の実運用
Owner: 人間 + Claude Code（ログ解析）
Accept:
- [ ] 7日間の行動・獲得・閉店までの進み・不満点を `docs/state/soak-YYYYMMDD.md`（40行以内）にまとめる

### P7-T3 バランス調整
Owner: Muse Spark | Read: spec/23-core-economy, spec/30-activity-claims（変換節）, spec/21-core-lottery
Do: 実運用を踏まえて economy / machines JSON を調整 → `pnpm sim econ` と `pnpm sim run` で確認 → ゴールデン更新（DECISIONS に記録）。
