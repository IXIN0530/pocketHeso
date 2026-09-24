# Tooling & Agent Workflow

## 前提
- macOS 26 + Xcode 26.3 以降（AlarmKit・iOS 26 SDK・Xcode MCP のため）
- `brew install xcodegen`
- Apple Developer Program（有料推奨: プロファイル1年。無料 Apple ID は7日で失効）

## スクリプト（P0-T1 で作成）
| コマンド | 内容 |
|---|---|
| `scripts/gen.sh` | `xcodegen generate` |
| `scripts/build.sh sim` | シミュレーター向けビルド（既定） |
| `scripts/build.sh device` | 実機向けビルド |
| `scripts/install.sh` | `xcrun devicectl device install app` で 16e にインストール |
| `scripts/test.sh core` | `swift test --package-path Packages/PachinkoCore` |
| `scripts/test.sh all` | core + `xcodebuild test` |
| `scripts/sim.sh ...` | `swift run --package-path Packages/PachinkoCore pachisim ...` |
| `scripts/agy.sh [agy の引数]` | Antigravity CLI をリポジトリルートをワークスペースにして起動（素の `agy` は `.agents/` 等を読まないことがある） |
出力は最後の40行だけ表示し、全文は `logs/` に保存する（エージェントのトークン節約）。

## Xcode MCP（必要な時だけ）
- Xcode → Settings → Intelligence → Model Context Protocol → Xcode Tools を ON。Xcode でプロジェクトを開いておく。
- Claude Code: `claude mcp add --transport stdio xcode -- xcrun mcpbridge`（使い終わったら `claude mcp remove xcode`）
- OpenCode: `opencode.json` の `mcp.xcode.enabled` を true に。応答スキーマ不整合でエラーが出る場合は
  `mcpbridge-wrapper`（PyPI）を挟む。
- Antigravity CLI（agy）: `agy plugin enable xcode`（定義は `.agents/plugins/xcode/`、既定で無効）。使い終わったら `agy plugin disable xcode`。
- 用途: SwiftUI Preview 取得、ビルドログの構造化取得、Apple ドキュメント検索。通常ビルドはスクリプトで。

## エージェント分担
| 担当 | 向いている仕事 | フェーズ |
|---|---|---|
| **Claude Code** | Apple フレームワーク統合、entitlements、拡張間連携、実機スパイク、レビュー | P0, P4, P5, P6(配線), P7 |
| **OpenCode + Muse Spark 1.3** | 仕様が固い純粋ロジック、テスト大量生成、CLI、SpriteKit シーン量産 | P1, P2, P3, P6(演出) |
| **Antigravity CLI（agy）** | 並行作業・別視点レビュー。担当させるタスクは Owner を `Antigravity` にする | 未割当 |
- 3者とも同じ `/next` `/review <TaskID>` `/handoff` を持つ。定義は `.claude/` `.opencode/` `.agents/` にあり、**手順を変える時は3か所とも直す**。
- 書いた側と別のエージェントで `/review <TaskID>` を回す。
- 切替時は必ず `/handoff` で STATUS を更新してから終了する。
- Muse Spark の `contributor` / `contributor-free` 枠は、プロンプトと出力が Meta の学習に使われる。
  気になる場合は Standard 枠（`muse-spark-1.3`）に切り替える。

## トークン節約の設計
- 毎セッションの固定読み込み: AGENTS.md（+CLAUDE.md / GEMINI.md）+ STATUS.md ≒ 2K トークン以内。
- フェーズファイルは 2K、spec は各 2.5K トークン以内を目安に保つ。超えたら分割。
- 日本語は英語より概ねトークン数が多い。肥大化したら spec の英語化を検討。
