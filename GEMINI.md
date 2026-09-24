## Antigravity CLI（agy）固有
- 起動は `scripts/agy.sh`（= `agy --add-dir <repo>`）。素の `agy` ではこのファイルや `.agents/` が読まれないことがある。
- 共通ルールは同じディレクトリの AGENTS.md（agy が自動で読む）。ここには agy 専用の補足だけを書く。AGENTS.md を再度 include しないこと。
- `@[label](path)` include は起動時に展開される。**docs/ 配下を include しないこと**（トークン節約が崩れる）。パスで参照し、必要時に読む。
- スラッシュコマンドは `.agents/skills/`（`/next` `/review <TaskID>` `/handoff`）。`/review` は読み取り専用サブエージェント `reviewer` に任せる。
- Xcode MCP（`.agents/plugins/xcode`）は PWA 化（D-010）で不要。無効のまま使わない。
