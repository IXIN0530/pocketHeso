---
description: 指定タスクの差分レビュー（読み取り専用）
---
reviewer サブエージェントに以下を実行させ、その結果を報告する。

対象タスク: $ARGUMENTS（例: P2-T5）

1. `git log --oneline --grep "\[$ARGUMENTS\]"` で該当コミットを特定し、`git show --stat` → 必要なファイルだけ `git show` で差分を見る。
2. 該当フェーズファイルの当該タスク節と、その `Read:` にある spec だけを読む。
3. 確認観点: Accept の充足 / AGENTS.md の絶対ルール違反（決定論・import 境界・禁止演算）/ spec との不一致 / テスト不足 / 性能目標。
4. 出力は「重大 / 中 / 軽微」の3区分。各1〜2行、`ファイル:行` を添える。**コードは修正しない。**
5. 重大があれば `STATUS.md` の Blockers に1行追加する。
