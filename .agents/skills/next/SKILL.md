---
name: next
description: STATUS の次タスクを1つ実行する。ユーザーが /next と打った時、または「次のタスクを進めて」と頼んだ時に使う。/next の後にタスクID（例 P1-T3）があればそれを優先する。
---
1. `docs/state/STATUS.md` を読む。
2. `Current phase` のファイルを読み、`Next` のタスク節だけを対象にする（他タスクの節は読み飛ばす）。
3. そのタスクの `Read:` に列挙されたファイルだけを読む。
4. 実装し、`Accept:` を確認する（`scripts/test.sh` / `scripts/build.sh`）。実機が必要な項目は手順5の push 後に人間に依頼する。
5. コミット `[TaskID] 要約`。実機確認が要る項目があれば `dev` を push し（push しないと実機に届かない）、Vercel のプレビュー URL（Deployments の `dev` の最新）を開いてホーム画面に追加する手順と、確認項目を人間に渡す。
6. `STATUS.md` を更新: Last done / Next（フェーズ末なら次フェーズの T1 と Current phase も）/ Owner hint（次タスクの Owner）/ Blockers / Notes（最新3件）。
7. Owner は推奨担当で、固定ではない（人間がトークン残量などで切り替える）。担当が自分と違うタスクも実行してよいが、その旨を報告に1行書く。1回の `/next` は1タスクだけ実行して完了報告で止まり、次タスクとその推奨 Owner を添える。

ユーザーが `/next` の後にタスクIDを書いていれば、Next ではなくそのタスクを対象にする。
