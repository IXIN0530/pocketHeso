# Plan Index
フェーズは上から順に。各ファイルは単独で読めるように書いてある。**今のフェーズのファイルだけ読むこと。**

| Phase | ファイル | 主担当 | 目的 | 規模感 |
|---|---|---|---|---|
| P0 | P0-bootstrap.md | Claude Code | 骨組み＋実機スパイク（制約の実測） | 小 |
| P1 | P1-core-physics.md | Muse Spark | 乱数・盤面・物理（純 Swift） | 中 |
| P2 | P2-core-game.md | Muse Spark | Atlas・抽選・Engine・pachisim | 大 |
| P3 | P3-app-rendering.md | Muse Spark | アプリ内 SpriteKit 描画 | 中 |
| P4 | P4-runtime.md | Claude Code | 歩数・常駐・追いつき・永続化 | 中 |
| P5 | P5-surfaces.md | Claude Code | Live Activity・ロック画面ウィジェット | 中 |
| P6 | P6-hot-events.md | 両方 | 演出・通知拡張・AlarmKit | 大 |
| P7 | P7-soak-tune.md | Claude Code | 24h 実運用・電池・バランス | 小 |
| P8 | P8-distribution.md | どちらでも | README・配布経路（任意） | 小 |

並行可能: P1〜P2（Muse）と P4-T1/T2（Claude, Core に依存しない部分）。P3 以降は P2 完了が前提。

## タスク書式
```
### Pn-Tm タイトル
Owner: ... | Read: 読むファイル（これ以外は読まない）
Do: やること
Accept: 完了条件（コマンドで確認できる形）
```
