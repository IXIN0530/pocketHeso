# P3 Core: Idle Economy
前提: P2-T5 完了。すべて `packages/core/src/economy` と Engine への統合。Claude Code は T3・T4 をレビューする。

### P3-T1 経済定義と計算部品
Owner: Muse Spark | Read: spec/23-core-economy
Do: `resources/economy/default.json`（役物・強化・予告・閉店・claims 節の数値）、ロードと検証、
`Amount` 型、`1.15^n` 乗算キャッシュ表、`cbrt`（ニュートン法40回固定）、価格・まとめ買い価格、マイルストーン。
Accept:
- [ ] 価格表が手計算（10件）と一致 / `cbrt` が 1e0〜1e300 で相対誤差 1e-12 以内 / 禁止 API の lint 通過

### P3-T2 経済の状態遷移
Owner: Muse Spark | Read: spec/23-core-economy, spec/22-core-engine（入力節）
Do: 1000ms グリッドの economyTick（燃料・状態係数・放置効率・ブースト）、`buy`・`awaken`・`close` の検証と適用、
Grant 適用（燃料タンク上限と溢れ→ブースト）、streakMult、閉店（常連P計算とリセット範囲）。
Accept:
- [ ] 手書きシナリオ（燃料12h付与→背面8h→前面で購入→燃料切れ→閉店中10%）の最終状態が期待値と一致

### P3-T3 予告とオート打ちの統合
Owner: Muse Spark（Review: Claude Code）| Read: spec/23-core-economy（予告節）, spec/22-core-engine
Do: 前面時間での予告スケジュール（`notice` ストリーム）、`noticeTap` 検証と効果、オート打ち（share・止め打ち）と
パチンコ部の接続、釘調整 q・変動短縮・保留+1 の反映、`AwaySummary`、`HallProjection` の経済項目。
Accept:
- [ ] 決定論契約 1〜4 を経済込みでテスト、ゴールデン（`resources/golden/script01.json`）を固定
- [ ] 放置24時間の `advance` が Node で 150ms 以内（iPhone 300ms の目安）

### P3-T4 経済試算
Owner: Muse Spark（Review: Claude Code）| Read: spec/23-core-economy（バランス目標節）
Do: `pnpm sim econ --profile standard|none|heavy --days 30`: 行動プロファイル（日別の歩数・運動分・前面時間）から
Grant と Action を自動生成（「買えるものを安い順に買う」単純戦略）→ 日別の玉・常連P・メダル内訳（行動/パチンコ）を出力。
Accept:
- [ ] spec/23 のバランス目標3点を満たす。満たさない場合は数値を調整し DECISIONS に記録

### P3-T5 通貨分離・行動由来の転生・大当たりフィーバー（D-049, D-050）
Owner: Claude Code | Read: spec/23-core-economy, spec/21-core-lottery（出玉節）, spec/22-core-engine（SimEvent 節）
Do: 大当たりメダル廃止（機種 JSON の `medal`・`jackpotEnded.medals` を削除）、累計獲得メダル（Grant のみ加算・snapshot、旧版は 0 で読む）、
燃料0でオート停止、常連P の min 式と `close.medals_per_point`、常連倍率 `1+1.0P`、覚醒 `5×2^n`、
大当たりフィーバー（`jackpot_fever.mult_by_rate`）、1発のコスト = rate 玉。数値調整は T6 で行い、ここでは仮値でよい。
Accept:
- [ ] 大当たりでメダルが増えず、累計獲得メダルは Grant でだけ増え、覚醒・レート解放で消費しても減らない
- [ ] 燃料0でオートが発射しない／Grant で燃料が入ると再開／手動発射は燃料0でも打てる
- [ ] 常連P: 行動0なら獲得0・玉不足なら玉側が上限・既得を超えない・生産 ×(1+P) の境界テスト
- [ ] 大当たりフィーバーが jackpotStarted〜Ended の間だけ掛かり、レート別倍率・予告フィーバーとの掛け算になる
- [ ] 決定論契約 1〜4（1回 advance vs 不揃い刻み・snapshot）を通し、golden を更新して理由を STATUS に残す

### P3-T6 経済の再試算
Owner: Claude Code | Read: spec/23-core-economy（バランス目標節）
Do: `pnpm sim econ` に常連P（玉由来/行動由来）・閉店ごとの獲得・玉の内訳（役物/大当たりフィーバー/出玉）の列を追加し、
目標を新バランス目標に差し替え（メダル≥50% 判定は削除）。`--days` 84（12週）まで回し、default.json を調整。
Accept:
- [ ] spec/23 のバランス目標を標準・none・heavy × seed1〜3 × 3機種で満たす。調整値と長期（12週）の伸びの所見を DECISIONS に記録

