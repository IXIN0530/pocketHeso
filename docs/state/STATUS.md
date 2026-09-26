# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P7 → `docs/plan/P7-soak-tune.md`
- Last done: P7-T1 ローカル計測ログ（`metrics` store・Debug の「計測ログ」, D-071）。その前に [UI] iOS 風の操作感を実機確認OK（9/27）
- Next: P7-T2 1週間の実運用（人間が遊び、Debug の計測ログと記録を Claude Code が解析）。保留色の作り直しは P7-T4 として計画済み（後日）
- Owner hint: 人間 + Claude Code（ログ解析）

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [fix] 音が鳴らない（ホーム画面, 9/27 人間の報告）: 解錠を touch の pointerdown で先に呼ぶと iOS は resume を保留したままにし、SoundBus が「resume 待ち」のまま以後のタップで再試行しなかった。touchend/pointerup/click/keydown で解錠し、running でない間は毎回 resume＋無音再生、待ちは 500ms で切る。**実機確認待ち**（アプリを開いて何かタップ→リーチで鳴るか、Debug「音の状態」が running か）。
- P7-T1 (D-071): Worker の EngineHost が起動（全体・読込・追いつきの ms、追いついたゲーム時間、入力件数、IndexedDB 使用量）を30件、前面/操作の advance（回数・平均・最大・直近）、受け取り（回数・行数・最後）を `metrics` store に記録。Debug の「計測ログ」に表示・履歴・リセット。ヘッドレス Chrome x3600 で表示と2回目の起動（スナップショット）を確認。設定の「計測ログ・記録をコピー」で Debug の URL にせずに状態ダンプ（Projection・計測ログ・台帳の日/種類/量/燃料/メダル。claimId・地点は除く）を取れる。P7-T2 はこれを貼ってもらって解析（iOS の estimate はオリジン全体の使用量）。
- バランス（9/27 人間の指摘）: 風車を買うと一気に増えすぎる。Debug の x3600（1秒=1時間）と「燃料+12時間」（標準の約1週間分）で加速して見えるが、本番 x1 でも燃料ありの前面で 10分≈270/秒・30分≈3,000/秒・60分≈14,000/秒（役物だけの簡易モデル）、sim econ 標準は初日（燃料1.3h）でアタッカー到達。CC と比べ風車×5・回転体×2.5 と序盤の産出が多く、大当たりフィーバーの寄与は 20〜40%。調整（産出・価格の伸び・フィーバー倍率、spec/23 バランス目標の変更）は人間の判断待ち。
