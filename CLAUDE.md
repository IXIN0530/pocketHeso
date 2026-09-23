@AGENTS.md

## Claude Code 固有
- 上の AGENTS.md が共通ルール。ここには Claude Code 専用の補足だけを書く。
- `@` import は起動時に即時展開される。**docs/ 配下を `@` で import しないこと**（トークン節約が崩れる）。パスで参照し、必要時に Read する。
- サブエージェント `reviewer` は読み取り専用。レビュー依頼は `/review <TaskID>`。
- Xcode MCP（`xcrun mcpbridge`）はツール定義だけで数千トークン使う。ビルドは原則 `scripts/build.sh`、
  Preview 取得やビルドログ解析が必要な時だけ MCP を有効化する。
