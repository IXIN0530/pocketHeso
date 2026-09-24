# 10 Architecture

## スタック
TypeScript（strict）/ React 19 / Vite / PixiJS v8（盤面描画）/ Zustand（UI 状態）/ idb（IndexedDB）/
vite-plugin-pwa（manifest・Service Worker）/ Vitest / pnpm workspace。配信は Vercel（D-021）。

## パッケージ（pnpm workspace。依存は上→下のみ。逆方向・横方向の import 禁止）
```
apps/web  (React UI, PixiJS 描画, Service Worker, 永続化, 位置情報, クリップボード)
  │
  ├──────────────┬──────────────────┐
  ▼              ▼                  ▼
packages/fx    packages/claims    packages/shared
 (CueSheet 再生, (受け取りコード解析, (保存スキーマ型, 設定型,
  Web Audio,     チェックイン判定,    CueSheet の純データ型)
  Pixi フラッシュ) 台帳ルール)          ▲
  │              │                  │
  ▼              ▼                  │
packages/core ◄──────────────────────┘
 (純 TS。乱数・物理・Atlas・抽選・経済・Engine・Projection。DOM/React/Pixi を import しない)
tools/pachisim (Node CLI。Atlas 生成・統計・経済バランス試算。core のみに依存)
```
- `core` と `claims` は DOM 非依存（Node で単体テストできる）。ESLint で import 境界と禁止 API を機械的に検査（ref/conventions）。
- `claims` は `core` の型（`ActivityGrant` など）だけ使う。時刻・位置は引数で受け取る。

## データフロー
```
ショートカットのコード ─┐
チェックイン開始/終了 ───┼─▶ claims.verify() ─▶ ClaimLedger（IndexedDB, 追記のみ）
自己申告 ────────────────┘                          │ grants（営業時間・メダル・日付）
                                                     ▼
プレイヤー操作（購入・打つ設定・覚醒・閉店）─▶ ActionLog（追記のみ）
                                                     ▼
                              Engine.advance(to: now)  ──▶ [SimEvent]
                                                     ▼
                              project(state, now) ──▶ React / Pixi 描画
```
- **Engine の真実 = seed + 機種/盤面/Atlas + ClaimLedger の grants + ActionLog**。状態スナップショットはキャッシュ。
- 開いた時に `advance(to: now)` で放置中の分を一括計算（追いつき）。前面中は requestAnimationFrame とは独立に 1Hz で前進。
- 放置中の結果は前面に戻った時に確定。Service Worker は Engine を回さない。

## 保存（IndexedDB `pocketheso`）
| store | 内容 |
|---|---|
| `meta` | スキーマ版数、seed、作成日時 |
| `claims` | ClaimLedger（追記のみ、キー = `claimId`） |
| `actions` | ActionLog（追記のみ、時刻昇順） |
| `snapshot` | Engine スナップショット（直近1件＋1日1件を7日分） |
| `places` | 登録地点・OSM キャッシュ（spec/32） |
| `settings` | 設定 |
- 起動時に `navigator.storage.persist()` を要求。**セーブの書き出し/読み込み**（`PH-SAVE1:` + base64(gzip(JSON))）を必須機能にする。
- スナップショットは「seed + claims + actions」から必ず再生成できること（壊れても復元できる）。

## ディレクトリ
```
apps/web/src/{app,screens,components,board,stores,platform}/   platform = storage/geo/clipboard/audio/badge
packages/core/src/{math,rng,board,physics,atlas,machine,lottery,economy,engine,projection}/
packages/claims/src/{code,ledger,checkin,places,rules}/
packages/fx/src/  packages/shared/src/  tools/pachisim/src/
resources/{boards,machines,economy,packs,atlas}/     shortcut/（ショートカットの手順と配布リンク）
```
