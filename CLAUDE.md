@AGENTS.md

## Claude Code 固有
- 上の AGENTS.md が共通ルール。ここには Claude Code 専用の補足だけを書く。
- `@` import は起動時に即時展開される。**docs/ 配下を `@` で import しないこと**（トークン節約が崩れる）。パスで参照し、必要時に Read する。
- サブエージェント `reviewer` は読み取り専用。レビュー依頼は `/review <TaskID>`。
- 実機（iPhone）でしか確認できない項目は、手順を提示して人間に依頼し、結果を STATUS Notes に残す。
