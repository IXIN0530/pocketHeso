# Tooling & Agent Workflow
（Xcode / XcodeGen 時代の内容は docs/archive/native-v1/ref/tooling.md）

## 前提
- Node 22 LTS、pnpm 9（`corepack enable`）。macOS / Linux / Windows のどこでも開発できる。
- 実機確認: iPhone の Safari で開発サーバー（同一 LAN）か GitHub Pages のプレビューを開き、ホーム画面に追加する。
  - 開発サーバーは `pnpm dev --host`。位置情報・クリップボード・SW は HTTPS が必要 → 実機確認は Pages か
    `pnpm preview` をトンネル（例: `cloudflared tunnel --url`）で HTTPS 化して行う。
  - Mac の Safari「開発」メニュー → 接続した iPhone で Web インスペクタが使える（iPhone 側で Web インスペクタを ON）。
- Apple Developer Program は不要。

## スクリプト（P0-T1 で作成。出力は最後の40行だけ表示し、全文は `logs/` に保存する）
| コマンド | 内容 |
|---|---|
| `scripts/dev.sh` | `pnpm --filter web dev --host` |
| `scripts/build.sh` | 型検査＋lint＋`vite build`（全パッケージ） |
| `scripts/test.sh core` | `pnpm --filter core --filter claims test`（Node, 決定論テスト含む） |
| `scripts/test.sh all` | 全パッケージのテスト |
| `scripts/sim.sh ...` | `pnpm --filter pachisim start ...`（Atlas 生成・統計・経済試算） |
| `scripts/agy.sh [agy の引数]` | Antigravity CLI をリポジトリルートをワークスペースにして起動 |

## デプロイ
- GitHub Actions: main への push → `scripts/build.sh` → `apps/web/dist` を GitHub Pages に公開。
- Vite の `base` は `/PocketHeso/`（リポジトリ名に合わせる。フォークした人は環境変数 `PH_BASE` で変更）。

## エージェント分担
| 担当 | 向いている仕事 | フェーズ |
|---|---|---|
| **Claude Code** | ブラウザ API 統合、PWA/SW、ショートカット、実機スパイク、UI の配線、レビュー | P0, P4, P5, P8 |
| **OpenCode + Muse Spark 1.3** | 仕様が固い純粋ロジック、テスト大量生成、CLI、演出シーン量産 | P1, P2, P3, P6 |
| **Antigravity CLI（agy）** | 並行作業・別視点レビュー。担当させるタスクは Owner を `Antigravity` にする | 未割当 |
- 3者とも同じ `/next` `/review <TaskID>` `/handoff` を持つ。定義は `.claude/` `.opencode/` `.agents/` にあり、**手順を変える時は3か所とも直す**。
- 書いた側と別のエージェントで `/review <TaskID>` を回す。
- 切替時は必ず `/handoff` で STATUS を更新してから終了する。
- Muse Spark の `contributor` / `contributor-free` 枠は、プロンプトと出力が Meta の学習に使われる。
  気になる場合は Standard 枠（`muse-spark-1.3`）に切り替える。
- Xcode MCP（`opencode.json` / `.agents/plugins/xcode`）は PWA 化で不要。既定で無効のまま触らない。

## トークン節約の設計
- 毎セッションの固定読み込み: AGENTS.md（+CLAUDE.md / GEMINI.md）+ STATUS.md ≒ 2K トークン以内。
- フェーズファイルは 2K、spec は各 2.5K トークン以内を目安に保つ。超えたら分割。
- `docs/archive/` と `archive/` は読まない（転換前の資料。必要な内容は新 spec に移植済み）。
