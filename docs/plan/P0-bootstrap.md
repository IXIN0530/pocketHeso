# P0 Bootstrap & Spikes
目的: 旧 Swift コードを退避し、TS の骨組みと配信経路を作り、**実機で Web / ショートカットの制約を実測** してから本実装に入る。
スパイクのコードは `apps/web/src/spikes/` に隔離し、`?spike=<name>` でのみ表示する。

### P0-T1 旧コード退避と TS 骨組み
Owner: Claude Code | Read: spec/10-architecture, ref/tooling, ref/conventions
Do:
- `App/ Extensions/ Packages/ Resources/ PocketHeso.xcodeproj project.yml scripts/{gen,install,build,test,sim}.sh` を削除
  （タグ `native-v1` に保存済み, D-018）。`.gitignore` から Xcode 系を整理。`opencode.json` の xcode MCP は無効のまま残す。
- pnpm workspace: `apps/web`（Vite + React 19 + TS）、`packages/{core,claims,fx,shared}`、`tools/pachisim`。
- tsconfig（strict ほか ref/conventions）、ESLint（禁止 API・import 境界）、Vitest、各パッケージにダミーテスト1件。
- `scripts/{dev,build,test,sim}.sh` を ref/tooling どおりに作り直す（出力末尾40行＋`logs/`）。
Accept:
- [ ] `scripts/build.sh` と `scripts/test.sh all` が通る
- [ ] `packages/core` に `Math.random()` を書くと lint が落ちる（確認後に削除）
- [ ] リポジトリ直下に Swift / Xcode の残骸が無い（`git ls-files | grep -E '\.swift$|project\.yml'` が空）

### P0-T2 PWA と Vercel 配信
Owner: Claude Code | Read: spec/41-pwa-platform（配布・Service Worker 節）
Do: manifest・アイコン（仮）・vite-plugin-pwa。`dev`・タグを push（人間の了承後）→ 人間が Vercel で Import → プレビューを確認 → main へ ff マージで本番。
Accept:
- [ ] Vercel の本番 URL を iPhone でホーム画面に追加 → standalone で起動、機内モードでも起動する
- [ ] 人間が実機確認し STATUS Notes に記録

### P0-T3 スパイク: ショートカット連携
Owner: Claude Code（実機は人間）| Read: spec/31-shortcut-health, ref/platform-limits（ヘルスケア節）
Do: `resources/shortcut/README.md` に作成手順（spec/31 の中身）を書く。PWA 側に `?spike=shortcut`:
「ショートカットを開く」ボタン、復帰検知ログ、「貼り付け」ボタンで生テキストを表示。
Accept:
- [ ] ホーム画面 PWA → `shortcuts://` 起動 → 戻る → `readText()` でコードを取得、の可否と手順を platform-limits に記入
- [ ] 歩数合計が「ヘルスケア」アプリの表示と一致するか、ワークアウト種類名の日本語表記を記録
- [ ] ロック中のオートメーション実行の成否を記録

### P0-T4 スパイク: 位置情報と Overpass
Owner: Claude Code（実機は人間）| Read: spec/32-training-checkin, ref/platform-limits（PWA・OSM 節）
Do: `?spike=geo`: 現在地の accuracy 表示、spec/32 の Overpass クエリ結果一覧、許可状態の表示。
Accept:
- [ ] 許可が毎回聞かれるか、屋内ジム/公園での accuracy を platform-limits に記入
- [ ] 近所の施設が何件ヒットするか記録。半径の既定値を見直す必要があれば DECISIONS へ

### P0-T5 スパイク: 保存・音・描画性能
Owner: Claude Code | Read: spec/41-pwa-platform（保存節）, spec/50-app-rendering（性能目標）
Do: `?spike=perf`: Pixi で 20玉＋役物8＋虹フィルタ、FPS 表示。`storage.persist()` 結果、Web Audio の再生（消音スイッチ ON/OFF）。
Accept:
- [ ] 16e で 60fps か（未達なら計測値を Blockers）
- [ ] persist の結果と、消音スイッチ時の音の挙動を platform-limits に記入
