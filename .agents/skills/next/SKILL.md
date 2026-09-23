---
name: next
description: STATUS の次タスクを1つ実行する。ユーザーが /next と打った時、または「次のタスクを進めて」と頼んだ時に使う。/next の後にタスクID（例 P1-T3）があればそれを優先する。
---
1. `docs/state/STATUS.md` を読む。
2. `Current phase` のファイルを読み、`Next` のタスク節だけを対象にする（他タスクの節は読み飛ばす）。
3. そのタスクの `Read:` に列挙されたファイルだけを読む。
4. 実装し、`Accept:` を確認する（`scripts/test.sh` / `scripts/build.sh`）。実機が必要な項目は手順を提示して人間に依頼する。
5. コミット `[TaskID] 要約`。
6. `STATUS.md` を更新: Last done / Next（フェーズ末なら次フェーズの T1 と Current phase も）/ Owner hint（次タスクの Owner）/ Blockers / Notes（最新3件）。
7. 次タスクの Owner が `Antigravity` 以外の場合はそこで止まり、完了報告だけする。

ユーザーが `/next` の後にタスクIDを書いていれば、Next ではなくそのタスクを対象にする。
