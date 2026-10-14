# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P12（閉店後の休業 → `docs/plan/P12-rest-phase.md`）。P11-T6 の本番確認は Blockers。P8-T7（任意）と P7 再開は人間の指示待ち
- Last done: P12-T3（web: 閉店でツリーシート自動表示・「休業中　自動で開店まで M:SS」と「開店する」・帯「休業中　開店する ›」と pending・timing 小札・opened 演出・SNAPSHOT 7。build・test all OK）。その前: P12-T2
- Next: P12-T4（実機確認。dev push 済み・結果待ち。OK なら T5 は人間の「リリースしてよい」待ち）
- Owner hint: 人間（手順は Claude Code（Sonnet））
- Paused: P7 → `docs/plan/P7-soak-tune.md` / T11 → T12 → T13 → T2 は人間の指示で再開

## Blockers
- v1.2.1 の本番確認が人間待ち（Debug が無い・バージョン v1.2.1・短い留守でサマリーが出ない・オート打ちの設定が崩れない）
- v1.2.0 の本番確認が人間待ち（Debug が無い・バージョン v1.2.0・既存セーブで常連P・ツリーで開けて閉店後も残る）
- **P10-T5 検証 5・6 の 2 週が NG（人間判断、T6 以降は進めてよい。P12-T2 の測り直しでも同値: `--tree all` は休業の影響を受けない）**: 開店ダッシュを割り戻すと 12週中10週は 3.7〜5.4 だが、lt r74 3週目 6.08（基準 ≤5.5）・rush r180 4週目 7.00（≤6.0）。役物 Lv の段差による一時的な週。A そのまま（推奨）/ B densetsu・meiten の prod_add を下げて再試算。詳細 `docs/state/econ-20261013-p10.md`・D-105
- Vercel 設定の人間確認待ち（Production の `VITE_YOLP_APPID`・本番ドメイン・Deployment Protection なし）
- **バランス持ち越し（リリース優先で人間判断済み）**: P8-T9 の 3・EV NG、P7-T10 の内訳・初閉店は未解決のまま v1.0.0 に含む。詳細は `docs/state/econ-20260929.md` / `econ-20260928.md`
- **持ち越し（人間がリリース指示、v1.1.0 に含む）** P9-T5（値は未変更）: lt の12週 perSec 伸びが実績込みで NG（×2.85 vs ×3.00。実績なしは OK）。1週目の達成数が想定 12〜16 に対し 17。mult_per・一覧を見直すか、そのままにするか
- 既定機種の人間確認待ち（light/rush/ltのどれを既定にするか。P3バランスに影響）

## Notes（最新3件まで）
- [P12-T4]: dev を c586ad1 まで push 済み。手順 1〜4 を人間に渡した。結果待ち。
- [P12-T3]: 帯と留守バナーは同じ位置で重なるが、留守バナーが5秒で消えた後に帯が見える。担当は Sonnet 推奨だが Opus で実行した旨を報告する
- [P12-T2]: 5・6 の NG は P10-T5 と同じ値・同じ週なので新しい Blocker にせず既存の行に追記して T3 へ進める（人間が P10 で「先へ進めてよい」と判断済み）。econ.ts と試算は Sonnet（worker）、合否・spec/25・D-109 は Opus
- [P12-T1]: web は T3 まで「開店する」が無く、dev で閉店すると30分後に自動で開く（dev は未 push）。pachisim は同じ t で open を足して従来どおり（閉店→買う→開店は T2）。web の tree-defs.test に timing を足しただけ。Opus
