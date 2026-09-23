# PocketHeso — Agent Instructions

通知欄に常駐し、歩数に応じて自動で打ち続けるパチンコシミュレーター。
対象: iPhone 16e (A18, **Dynamic Island 非搭載**) / iOS 26.x / 非脱獄。個人利用＋GitHub配布。
Stack: Swift 6 / SwiftUI / SpriteKit / ActivityKit / WidgetKit / AlarmKit / XcodeGen。

## 読み込みルール（トークン節約・厳守）
1. このファイルは自動で読まれている。追加で読むのは次の順だけ。
2. `docs/state/STATUS.md` を読む（短い）。
3. STATUS の `Current` が指すフェーズファイル `docs/plan/Pn-*.md` を **1つだけ** 読む。
4. タスクの `Read:` に列挙された spec/ref **だけ** を読む。列挙外の docs は開かない。
5. `docs/` の一括 grep・一括読み込み禁止。追加で必要なら理由を1行書いてから1ファイルずつ。
6. ソースは作業対象モジュールのみ。他モジュールは公開 API（`public`）だけ確認する。

## 絶対ルール
- `PachinkoCore` は UIKit / SwiftUI / SpriteKit / ActivityKit / CoreMotion を import しない。
- 決定論を壊さない: Core 内で `Date()`・`.random`・`Task`/並列・`Dictionary`/`Set` の反復順依存を使わない。
  時刻と乱数は必ず引数で受け取る。
- 物理の内側ループは `+ - * / sqrt` のみ。`sin/cos/pow/exp/atan2` は禁止（事前計算テーブルを使う）。
- `.xcodeproj` は生成物。直接編集せず `project.yml` を編集して `scripts/gen.sh`。
- 1タスク = 1コミット。メッセージは `[P1-T3] 要約`。
- 仕様から外れる判断は `docs/state/DECISIONS.md` に3行以内で追記。
- タスク終了時に `docs/state/STATUS.md` を更新（Last done / Next / Blockers / Notes）。

## 完了の定義
- Core を触った: `scripts/test.sh core` が通る
- アプリ/拡張を触った: `scripts/build.sh` が通る
- タスクの `Accept:` を全て満たす。満たせない項目は STATUS の Blockers に書いて止まる。

## コマンド
`scripts/gen.sh`（Xcodeプロジェクト生成）/ `scripts/build.sh [sim|device]` /
`scripts/test.sh [core|all]` / `scripts/sim.sh <pachisim args>`

## ドキュメント索引（必要な時だけ開く）
| ファイル | 開くタイミング |
|---|---|
| docs/ref/platform-limits.md | iOS の制限値・API の可否を判断する時（推測で書かない） |
| docs/ref/conventions.md | 新規ファイル作成・命名・テストの書き方に迷った時 |
| docs/ref/tooling.md | ビルド・実機インストール・Xcode MCP・エージェント分担 |
| docs/spec/00-overview.md | 機能の全体像を確認する時のみ |
| docs/spec/10-architecture.md | モジュール境界・依存方向・ターゲット構成 |
| docs/spec/20-core-physics.md | 盤面・物理・Outcome Atlas |
| docs/spec/21-core-lottery.md | 抽選・保留・先読み・状態遷移 |
| docs/spec/22-core-events.md | Engine API・SimEvent・投影・決定論契約 |
| docs/spec/30-runtime.md | 入力・常駐・追いつき・永続化 |
| docs/spec/40-surface-live-activity.md | Live Activity |
| docs/spec/41-surface-widgets.md | ロック画面ウィジェット |
| docs/spec/42-surface-hot-events.md | 激アツ演出・通知拡張・AlarmKit |
| docs/spec/50-app-rendering.md | アプリ内 SpriteKit 描画 |
