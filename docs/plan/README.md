# Plan Index
フェーズは上から順に。各ファイルは単独で読めるように書いてある。**今のフェーズのファイルだけ読むこと。**
（iOS ネイティブ時代の計画は docs/archive/native-v1/plan。D-010 で破棄）

| Phase | ファイル | 主担当 | 目的 | 規模感 |
|---|---|---|---|---|
| P0 | P0-bootstrap.md | Claude Code | 旧コード退避・TS 骨組み・Vercel 配信・実機スパイク | 小 |
| P1 | P1-core-physics.md | Muse Spark | 乱数・盤面・物理（純 TS） | 中 |
| P2 | P2-core-game.md | Muse Spark | Atlas・抽選・Engine（パチンコ部）・pachisim | 大 |
| P3 | P3-core-economy.md | Muse Spark | 放置経済・Engine 統合・経済試算 | 中 |
| P4 | P4-activity.md | Claude Code | 受け取り台帳・ショートカット・チェックイン | 中 |
| P5 | P5-app.md | 両方 | React 画面・Three.js 描画・保存・PWA | 大 |
| P6 | P6-presentation.md | 両方 | 演出・音・光・予告・留守中リプレイ | 中 |
| P7 | P7-soak-tune.md | Claude Code | 1週間の実運用・バランス調整（大当たりボーナス・行動の即時報酬・階段・遠征・新台入替） | 中 |
| P8 | P8-release.md | Muse Spark | 正式版（開発用表示を本番から除く）・ショートカットを iCloud リンク1つで・初回案内・README・main へのリリース・任意の Web Push | 中 |
| P9 | P9-update-1-1.md | Claude Code | v1.1: 大当たりのラウンド5倍速・永続の実績（生産倍率）・レート選択の表示修正・v1.1.0 リリース | 中 |
| P10 | P10-prestige-tree.md | Claude Code | v1.2: 常連ツリー（常連P の使い道）・v1.2.0 リリース | 大 |
| P11 | P11-feedback-1-2.md | Claude Code | v1.2.1: 留守サマリーのバナー化・常連P の式の表示・オート打ち UI・実績の表記 | 小 |
| P12 | P12-rest-phase.md | Claude Code | v1.3: 閉店後の休業（常連P を使ってから開店）・v1.3.0 リリース | 中 |
| P13 | P13-feedback-1-3.md | Claude Code | v1.4: 抽選カスタム（先バレ）・先バレの時刻と音・大当たりの先出し・RUSH の変化保留・覚醒 v2 と役物を強くするツリー・v1.4.0 リリース | 大 |
| P14 | P14-shops-spec.md | Claude Code | v1.5: 店の開放を常連ツリー段1に（遠征は取り下げ）・休業中の台選び（新台入替）・台のスペック画面・v1.5.0 リリース | 中 |

並行可能: P1〜P3（Muse）と P4-T1〜T3（Claude。claims は Core の型だけに依存）。P5 は P2-T5 完了が前提。

## タスク書式
```
### Pn-Tm タイトル
Owner: Claude Code（Opus|Sonnet） | Read: 読むファイル（これ以外は読まない）
Split: （任意）Opus — 部分A / Sonnet — 部分B（上から順に実行）
Do: やること
Accept: 完了条件（コマンドで確認できる形）
```
- Claude Code のタスクには推奨モデルを書く（トークン効率のため）。目安: **Opus** = 決定論・Core の設計・spec の解釈・バランスの判断。
  **Sonnet** = 既存の型をなぞる UI・テストの列挙・ツール引数・ドキュメント反映・定型の手順（push・リリース）。
- `Split:` は1タスクの中で担当モデルを分けたい時だけ。`/next` が自分と違うモデルの部分を `worker` サブエージェントに渡し、コミットは1つにまとめる（`.claude/commands/next.md` 手順3）。
- 人間はどちらのモデルのセッションで `/next` を打ってもよい（違うモデルの部分は自動でサブエージェントに回る）。
