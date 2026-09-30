# PocketHeso — Agent Instructions

良い行動（運動・トレーニング）で「営業時間」を得て、放置で玉が増えるパチンコ放置ゲーム（PWA）。
対象: iPhone 16e / iOS 26.x Safari（ホーム画面 Web アプリ）＋ iOS ショートカット。個人利用＋Vercel 配信・GitHub 公開。
Stack: TypeScript / React 19 / Vite / Three.js / IndexedDB / Service Worker / Vitest / pnpm workspace。
（2026-09-24 に iOS ネイティブから転換: D-010。旧資料は docs/archive/、旧コードはタグ `native-v1`）

## 読み込みルール（トークン節約・厳守）
1. このファイルは自動で読まれている。追加で読むのは次の順だけ。
2. `docs/state/STATUS.md` を読む（短い）。
3. STATUS の `Current` が指すフェーズファイル `docs/plan/Pn-*.md` を **1つだけ** 読む。
4. タスクの `Read:` に列挙された spec/ref **だけ** を読む。列挙外の docs は開かない。
5. `docs/` の一括 grep・一括読み込み禁止。追加で必要なら理由を1行書いてから1ファイルずつ。`docs/archive/` は読まない。
6. ソースは作業対象パッケージのみ。他パッケージは公開 API（`index.ts` の export）だけ確認する。

## 絶対ルール
- `packages/core` は DOM・React・Three・ブラウザ API を import / 参照しない。他パッケージも import しない。
- 決定論を壊さない: Core 内で `Date.now()`・`Math.random`・非同期・`Map`/`Set`/オブジェクトの反復順依存を使わない。
  時刻と乱数は必ず引数で受け取る（乱数は `RNGStream`）。
- Core の数値計算は `+ - * /`・`Math.sqrt`・`Math.floor`・比較のみ。`Math.sin/cos/pow/exp/log/hypot/cbrt`・`**` は禁止（事前計算表を使う）。
- 行動データ・位置情報は端末外に送らない（YOLP への問い合わせ座標を除く, D-025）。生の座標は保存しない。
- 作業は `dev` ブランチ。`main` は公開版なので直接コミットしない（D-019）。
- 実機確認は Vercel のプレビュー URL（`dev` への push ごとに発行）で行う。人間に実機確認を頼む前に必ず `dev` を push する
  （`dev` への push は許可済み。push しないと実機に届かない）。`main` への push・マージは人間の指示がある時だけ。
- 1タスク = 1コミット。メッセージは `[P1-T3] 要約`。
- 仕様から外れる判断は `docs/state/DECISIONS.md` に3行以内で追記。
- タスク終了時に `docs/state/STATUS.md` を更新（Last done / Next / Blockers / Notes）。

## 完了の定義
- Core / claims を触った: `scripts/test.sh core` が通る
- それ以外を触った: `scripts/build.sh` と `scripts/test.sh all` が通る
- タスクの `Accept:` を全て満たす。満たせない項目は STATUS の Blockers に書いて止まる。

## コマンド（P0-T1 で作成）
`scripts/dev.sh`（開発サーバー）/ `scripts/build.sh`（型検査・lint・ビルド）/ `scripts/test.sh [core|all]` /
`scripts/sim.sh <pachisim args>` / `scripts/agy.sh`（Antigravity CLI 起動）

## ドキュメント索引（必要な時だけ開く）
| ファイル | 開くタイミング |
|---|---|
| docs/ref/platform-limits.md | Web / iOS / ショートカット / 施設検索（YOLP）の制限と可否を判断する時（推測で書かない） |
| docs/ref/conventions.md | 新規ファイル作成・命名・テスト・lint ルールに迷った時 |
| docs/ref/tooling.md | ビルド・実機確認・デプロイ・エージェント分担 |
| docs/spec/00-overview.md | 機能の全体像を確認する時のみ |
| docs/spec/10-architecture.md | パッケージ境界・依存方向・データフロー・保存 |
| docs/spec/20-core-physics.md | 盤面・物理・Outcome Atlas |
| docs/spec/21-core-lottery.md | 機種・抽選・保留・乱数・レート |
| docs/spec/22-core-engine.md | Engine API・入力（Grant/Action）・SimEvent・決定論契約・Projection |
| docs/spec/23-core-economy.md | 放置経済（役物・強化・予告・燃料・閉店・バランス目標） |
| docs/spec/24-core-achievements.md | 実績（指標・一覧・永続の生産倍率・判定・保存） |
| docs/spec/30-activity-claims.md | 行動→報酬の台帳・換算・上限・連続日数 |
| docs/spec/31-shortcut-health.md | iOS ショートカットとヘルスケア同期 |
| docs/spec/32-training-checkin.md | トレーニングのチェックイン（位置・登録地点・YOLP） |
| docs/spec/40-app-ui.md | React 画面・状態管理・前面/背面 |
| docs/spec/41-pwa-platform.md | 配布・Service Worker・保存・OS 連携・（任意）Web Push |
| docs/spec/43-presentation-effects.md | 音・光・振動、CueSheet、演出パック |
| docs/spec/50-app-rendering.md | Three.js 描画 |
