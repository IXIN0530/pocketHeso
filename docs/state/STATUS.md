# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P7 → `docs/plan/P7-soak-tune.md`
- Last done: [P7-T10] 試算とバランス目標の確認（27条件の表 `docs/state/econ-20260928.md`・sim に12週の伸びの判定）
- Next: P7-T11 階段 → T12 → T13 → P7-T2 1週間の実運用。並行で人間の実機確認（T7・T9）とバランスの判断（Blockers）
- Owner hint: Claude Code
- Parallel: P8 → `docs/plan/P8-release.md` / Next: P8-T2 / Owner: Muse Spark（OpenCode で `/next P8`。P7 と同時に走らせない。T3 は P7-T11 の後、T6 は人間の指示で）

## Blockers
- ライセンスの選択（P8-T5 の前提。人間が決める）
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）
- **バランス（P7-T10, 人間の判断待ち）**: 標準1〜7日の内訳 大当たり/行動 = light 12/66%・rush 24/58%・lt 47/39%（目標 各25〜45%）。原因は行動の即時が週「生産48時間ぶん」に対し燃料が週13.3時間で役物が約8時間ぶんしか回らないこと。初閉店 day5（メダル28枚/Pで決まる）、全強化EV 1.08〜1.23（D-079 の自動補充）も NG。値は変えていない。詳細と選択肢は `docs/state/econ-20260928.md`

## Notes（最新3件まで）
- [P8-T1]: __DEV_TOOLS__（Production/PH_RELEASE=1でfalse）でDebug・spike・計測ログを本番から落とす。version 1.0.0。release-checkは正式版に目印5種なし・devにGrant注入あり。build・test all通過。**実機確認待ち**（devプレビューでDebug・spike・計測ログが残っていること）。
- [P7-T10]: econ を 3プロファイル×3機種×7/28/84日で実行。OK: クルーン1日目・覚醒3〜4日目・初回+1・4週で閉店5回・週次perSec上昇・12週 perSec×5.9〜6.1 ≥ (1+P)×3・heavy 25P > std 17P・none 閉店0・初期EV。閉店の条件は玉が律速でないため直していない（DECISIONS なし）。sim に `12w perSec growth` 判定を追加。test all・build 通過、golden 不変。
- [P7-T9]: 確認画面「玉 生産◯ぶん ≈ ◯玉」（refPerSec×分×60）・特別保留、確定後トーストは granted の balls 合計（receiveClaims が返す）。今日の残りは上限超えの仮入力を planGrants に通して算出（歩数＋施設チェックイン＋自己申告）。HUD は bonusStock>0 で「特別保留 ×n（待機）」。液晶は serial 1.5e9 台に「特」の札（Projection から復元した保留は -1 で札なし＝既知の制限）。記録は日別に 生産◯ぶん・特別保留（玉数は台帳に無い）、統計に大当たりボーナス。Debug の付与は確認シート経由・玉/特別保留ボタン追加。ヘッドレス Chrome(CDP, x60)で 見込み3,600玉→持ち玉100→3,700・トースト・記録、x1 で札と「×2（待機）」を確認。web72・build通過。音なし。**実機確認待ち**。
