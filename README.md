# PocketHeso

良い行動（歩数・ワークアウト・ジムや公園でのトレーニング）をすると「営業時間」がもらえ、
その間パチンコホールの役物が回って玉が増えていく放置ゲーム。玉は強化にも、パチンコを打つ（抽選）のにも使える。
React + TypeScript の PWA。iPhone ではホーム画面に追加し、ヘルスケアの運動記録は iOS ショートカット経由で受け取る
（Apple Developer Program 不要）。

## 遊ぶ人向け

### 何のゲームか

- 良い行動 → 燃料（営業時間）→ 役物が回って玉が増える → 玉で強化・パチンコ、の放置ゲーム。
- 初回起動の「はじめての案内」3枚（何のゲームか／ホーム画面に追加／受け取り方）を見れば遊べる。

### 遊ぶ（本番 URL）

- 本番 URL: （未公開。P8-T6 のリリースで記入する。Vercel の Production）
- それまでは開発者のプレビュー URL（`dev` ブランチへの push ごとに発行）で試す。

### ホーム画面に追加（iPhone）

1. Safari で本番 URL を開く。
2. 共有ボタン →「ホーム画面に追加」。
3. 以後はホーム画面のアイコンから開く（通常の Safari タブでも動くが、保存場所が別になるのでどちらか一方で遊ぶ）。

### ショートカットの入れ方（運動の受け取り）

- iCloud 共有リンク: （未発行。P8-T3 で記入する）
- 手順は `resources/shortcut/README.md` の「1. 使い方（利用者向け）」の通り。鍵を貼る手順は無い。
  1. 上のリンクから `PocketHeso Sync` を追加。
  2. 設定 → アプリ → ショートカット → 詳細 →「大量のデータの共有を許可」をオン。
  3. 行動タブの「運動を受け取る」→ ショートカットが実行されたら戻って「貼り付けて受け取る」→ 確認して確定。

### プライバシー

- 行動と位置のデータは端末の外に送らない。
- 施設を探す時だけ、現在地の座標を Yahoo! に送って施設の一覧をもらう。
- 施設情報: [Webサービス by Yahoo! JAPAN](https://developer.yahoo.co.jp/sitemap/)
- ショートカットが外部に送るものは無い（コードはクリップボード経由で渡るだけ）。

### セーブの書き出し

- セーブは端末の中（IndexedDB）だけにある。週1回「バックアップを書き出しましょう」が出る。
- 設定 → セーブ →「書き出す（コピー）」で `PH-SAVE1:…` をメモなどに保管。機種変更の前に書き出す。
- 新しい端末では同じ場所に貼って「読み込む」（今のデータは置き換わる）。
- プレビューと本番はアドレスが別なので保存も別。引き継ぐ時はプレビューで書き出し → 本番で読み込み。

## 開発者向け

### セットアップ

1. Node 22 以上、`npm i -g pnpm`
2. `pnpm install && scripts/dev.sh`（`pnpm dev --host`。実機は HTTPS が要るので Vercel プレビューかトンネル経由）
3. 進捗: `docs/state/STATUS.md`、計画: `docs/plan/`、仕様: `docs/spec/`、参照: `docs/ref/`
4. エージェント向け入口: `AGENTS.md`（OpenCode / 共通）/ `CLAUDE.md` / `GEMINI.md`

### フォークして出す（Vercel）

1. GitHub でこのリポジトリをフォーク。
2. [Vercel](https://vercel.com/) で New Project → フォークしたリポジトリを Import（設定ファイル `vercel.json` 済み。build = 型検査＋lint＋テスト＋`vite build`、出力 `apps/web/dist`）。
3. 環境変数（下の表）を Production に設定して Deploy。`main` への push が本番、その他のブランチがプレビュー。
4. 本番ドメインを開き、Safari でホーム画面に追加して動作確認（Debug タブが無い・バージョン表示・初回案内）。
5. ショートカットの iCloud リンクは `resources/shortcut/README.md` の「2. 作り方」で作り、`apps/web/src/platform/shortcut.ts` の `SHORTCUT_ICLOUD_URL`（または環境変数 `VITE_SHORTCUT_URL`）に設定して再デプロイ。

### 環境変数

| 変数 | 必須 | 内容 |
|---|---|---|
| `VITE_YOLP_APPID` | 任意（無ければ施設検索を使わず登録地点だけで判定） | Yahoo! YOLP の Client ID（施設検索用） |
| `VITE_SHORTCUT_URL` | 任意（無ければ `SHORTCUT_ICLOUD_URL` 定数） | 配布版ショートカットの iCloud リンク |

### ブランチ運用・スクリプト

- 作業は `dev`。`main` は本番で、直接コミットせず `dev` を fast-forward マージするだけ。版は `v1.x.y` タグ＋ルート `package.json` の version。
- `scripts/dev.sh`（開発サーバー）/ `scripts/build.sh`（型検査・lint・ビルド）/ `scripts/test.sh [core|all]` /
  `scripts/sim.sh <pachisim args>` / `scripts/release-check.sh`（`PH_RELEASE=1` で正式版に Debug・spike・計測ログが無いこと＋通常ビルドに残っていることを確認）。

### 素材の出所

音は Web Audio の合成音のみ（`resources/packs/default/pack.json`）、盤面・図柄・背景は起動時に Canvas で生成（`apps/web/src/board/art.ts`）、アイコンは自作の仮アイコン（`apps/web/public/icons/`）。参考用の実機画像は `images/` に置き公開リポジトリには入れない。ライセンスは MIT（`LICENSE`）。
