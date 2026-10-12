---
description: STATUS の次タスクを1つ実行する
---
1. `docs/state/STATUS.md` を読む。
2. 対象タスクを決める: 引数なし → `Current phase` 行の `Next`。引数がフェーズ（例 `P8`）→ STATUS でそのフェーズを指す行（`Current phase` か `Parallel`）の Next。引数がタスクID（例 `P8-T2`）→ そのタスク。タスクIDの `Pn` に対応する `docs/plan/Pn-*.md` を読み、その節だけを対象にする（他タスクの節は読み飛ばす）。
3. 実行の分け方を決める（モデルの振り分け。人間は `/next` を打つだけで、モデルの切り替えはここで行う）:
   - タスクの `Owner:` の `（Opus）`/`（Sonnet）` がタスク全体の推奨モデル。`Split:` 行があれば、その部分ごとのモデルが優先。どちらも無ければ自分で実行する。
   - 自分のモデル（システムプロンプトに記載）と同じ部分 → 自分で実行する。違う部分 → `worker` サブエージェント（Agent ツール、`subagent_type: worker`、`model` に `sonnet` か `opus`）に渡す。
   - タスク全体が自分と違うモデル → **自分は `Read:` を読まず**、タスク全体（手順4の実装と Accept の確認まで）を worker に渡す。
   - worker への指示: タスクID・担当範囲（`Split:` の文言）・前の部分の報告の要点・「コミットと STATUS 編集はしない」。`run_in_background: false` で1つずつ順に（同じ作業ツリーで同時に走らせない）。
4. 自分で実行する部分は、そのタスクの `Read:` に列挙されたファイルだけを読んで実装し、`Accept:` を確認する（`scripts/test.sh` / `scripts/build.sh`）。worker の分は報告と `git status`・`git diff --stat` で確かめ、最後に Accept のコマンドを自分で1回通す。実機が必要な項目は手順5の push 後に人間に依頼する。
5. コミット `[TaskID] 要約`（worker の分も含めて1タスク1コミット）。実機確認が要る項目があれば `dev` を push し（push しないと実機に届かない）、Vercel のプレビュー URL（Deployments の `dev` の最新）を開いてホーム画面に追加する手順と、確認項目を人間に渡す。
6. `STATUS.md` を更新: Last done / 実行したタスクの行の Next（`Parallel` 行のタスクなら `Parallel` 行だけを進め、`Current phase` 行は触らない。フェーズ末なら次フェーズの T1 と Current phase も）/ Owner hint（次タスクの Owner とモデル。例 `Claude Code（Opus）`）/ Blockers / Notes（最新3件）。
7. Owner は推奨担当で、固定ではない（人間がトークン残量などで切り替える）。担当が自分と違うタスクも実行してよいが、その旨を報告に1行書く。1回の `/next` は1タスクだけ実行して完了報告で止まり、次タスクとその推奨 Owner（モデル込み）を添える。報告には、どの部分をどのモデルで実行したかを1行で書く。

引数（なし・フェーズ・タスクIDのどれか。手順2）: $ARGUMENTS
