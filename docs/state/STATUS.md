# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P7 → `docs/plan/P7-soak-tune.md`
- Last done: P7-T4 保留色の作り直し＋保留変化（D-072。人間の指示で P7-T2 より先に実施）。その前に P7-T1 計測ログ（D-071）
- Next: P7-T4 の実機確認（保留の色・変化の見た目と音）→ P7-T2 1週間の実運用（人間が遊び、Debug の計測ログと記録を Claude Code が解析）
- Owner hint: 人間 + Claude Code（ログ解析）

## Blockers
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- バランス（9/27 人間の指摘: 風車を買うと増えすぎ。本番 x1 でも前面60分≈14,000/秒）: 産出・価格の伸び・フィーバー倍率の調整は人間の判断待ち（P7-T3。試算は commit 62de483 時点の STATUS Notes）

## Notes（最新3件まで）
- P7-T4 (D-072): 通常は 青7%・緑20%・赤50%・金85%（色付き約1/105）、ST・LT は B 案（青15・緑35・赤70・金95%、色付き約1/22）、hot は赤+1・金+2。`scripts/sim.sh holds` で3機種×通常/ST を各200万回転し全色 OK。保留変化は @ph/fx `planHoldChange`（取得時/消化時/変動開始時, 青20〜金55%）、液晶は `shownLcdState`、音・光はパックの `hold_<色>`。既存セーブはスナップショットから続き、これからの取得に新しい表が効く（ゴールデン 91097882cecf4959）。**実機確認待ち**: 保留が白などから上がる時に光って鳴るか・Debug の演出プレビューで変動開始の変化が出るか。
- [fix] 音が鳴らない（ホーム画面, 9/27 人間の報告）: 解錠を touch の pointerdown で先に呼ぶと iOS は resume を保留したままにし、SoundBus が「resume 待ち」のまま以後のタップで再試行しなかった。touchend/pointerup/click/keydown で解錠し、running でない間は毎回 resume＋無音再生、待ちは 500ms で切る。**実機確認待ち**（アプリを開いて何かタップ→リーチで鳴るか、Debug「音の状態」が running か）。
- P7-T1 (D-071): Worker の EngineHost が起動（全体・読込・追いつきの ms、追いついたゲーム時間、入力件数、IndexedDB 使用量）を30件、前面/操作の advance（回数・平均・最大・直近）、受け取り（回数・行数・最後）を `metrics` store に記録。Debug の「計測ログ」に表示・履歴・リセット。ヘッドレス Chrome x3600 で表示と2回目の起動（スナップショット）を確認。設定の「計測ログ・記録をコピー」で Debug の URL にせずに状態ダンプ（Projection・計測ログ・台帳の日/種類/量/燃料/メダル。claimId・地点は除く）を取れる。P7-T2 はこれを貼ってもらって解析（iOS の estimate はオリジン全体の使用量）。
