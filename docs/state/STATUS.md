# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P12（閉店後の休業 → `docs/plan/P12-rest-phase.md`）。P11-T6 の本番確認は Blockers。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P11-T6（v1.2.1 を main へ ff マージ・タグ v1.2.1 を push。build/test/release-check OK、T5 実機は人間 OK）。本番の確認は人間待ち。その前: P11-T4（記録の実績: 達成済みは「10月12日 達成」、次の1つは「n%」（切り捨て・99で止める）＋バー＋小さく「現在値 / しきい値」、達成済みは太字。build/test OK、実機は T5）。その前: P11-T3（設定のオート打ち: レートを数字だけの dense Segmented にして下に「1発 n玉（生産 s秒 × r パチ）」、「割合」「レート（パチ）」の見出しを追加。他の Segmented は最大5項目で dense 済み/3項目。build/test OK、実機は T5）。その前: P11-T2（閉店カードに「計算のしかた」: 玉由来・行動由来の式と次の +1、2つの累計玉を書き分け。Core は ShopCloseView に表示用 3 値を足しただけで golden 不変。実機は T5）。その前: P11-T1（留守サマリー: 5分未満は出さない・タップ不要のバナー・D-106。build/test OK、実機は T5）。その前: P10-T9（v1.2.0 を main へ ff マージ・タグ v1.2.0 を push。build/test/release-check OK）。本番の確認は人間待ち。その前: P10-T8（実機 OK）
- Next: P12-T1（Core: 休業と開店）
- Owner hint: Claude Code（Opus）
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- v1.2.1 の本番確認が人間待ち（Debug が無い・バージョン v1.2.1・短い留守でサマリーが出ない・オート打ちの設定が崩れない）
- v1.2.0 の本番確認が人間待ち（Debug が無い・バージョン v1.2.0・既存セーブで常連P・ツリーで開けて閉店後も残る）
- **P10-T5 検証 5・6 の 2 週が NG（人間判断、T6 以降は進めてよい）**: 開店ダッシュを割り戻すと 12週中10週は 3.7〜5.4 だが、lt r74 3週目 6.08（基準 ≤5.5）・rush r180 4週目 7.00（≤6.0）。役物 Lv の段差による一時的な週。A そのまま（推奨）/ B densetsu・meiten の prod_add を下げて再試算。詳細 `docs/state/econ-20261013-p10.md`・D-105
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P12 計画]: 人間の指摘（閉店直後に買った keep・starter・開店ダッシュが次の閉店まで効かない）から spec/25「休業」・D-107・P12 を追加。休業の上限 30分は spec/25 未決9（推奨で進める）。Opus
- [P11-T5]: dev を 9d9f269 まで push 済み。実機確認の結果待ち。Sonnet
- [P11-T3]: 見出し用に `activity.module.css` へ `.field`/`.fieldLabel` を追加。375px の横スクロールは T5 の実機項目で確認。Sonnet
