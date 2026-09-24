# Conventions
（Swift 時代の規約は docs/archive/native-v1/ref/conventions.md）

## TypeScript
- `strict: true`、`noUncheckedIndexedAccess: true`、`exactOptionalPropertyTypes: true`。`any` 禁止（`unknown` から絞る）。
- ESM のみ。Node 22 LTS、pnpm 9。
- Core の型は `interface` / `type` の純データ＋関数。`class` は Engine・BallSimulator など状態を持つものだけ。
- 公開 API（パッケージの `index.ts` から export するもの）には1行の TSDoc。内部実装には原則コメント不要（意図が非自明な箇所のみ）。
- 単位は変数名に入れる: `timeMs`, `posMM`, `velMMs`, `fuelMs`, `distM`。
- 時刻は Core では `SimTime`（number, UNIX ms 整数）。`Date` は Core 外で変換。
- 乱数は `RNGStream` 経由のみ。ストリーム ID は `RNGStreamID` に一元管理。

## Core の禁止事項（ESLint で機械検査）
- `packages/core` と `packages/claims` で禁止: `Date.now` / `new Date()`（claims は引数の日付文字列の解析のみ可）、
  `Math.random`、`crypto.getRandomValues`、`window` / `document` / `navigator`、`setTimeout` / `Promise` を返す公開 API。
- `packages/core` で追加禁止: `Math.sin/cos/tan/atan2/exp/log/pow/hypot/cbrt`、`**` 演算子。
- `Object.keys` / `for…in` / `Map` / `Set` の**反復順に結果が依存するコード**禁止（配列か、明示ソートを使う）。
- `no-restricted-imports` で依存方向（spec/10）を強制。`core` は他パッケージを import しない。

## React / UI
- 関数コンポーネント＋フック。1ファイル1コンポーネント。スタイルは CSS Modules。
- 画面は `screens/`、再利用部品は `components/`、ブラウザ API ラッパーは `platform/`（テスト時に差し替え可能にする）。
- 毎フレーム更新するもの（盤面）は React の state に入れない（spec/50）。

## ファイル
- 1ファイル1主要型。200行を超えたら分割を検討。ファイル名は kebab-case（`ball-simulator.ts`）、型は PascalCase。
- JSON リソースは `resources/` に置き、スキーマを spec に書く。キーは snake_case。
  読み込み時に検証する（手書きのバリデータ。スキーマライブラリは入れない）。

## テスト
- Vitest。Core/claims は Node 環境、UI は `happy-dom`。E2E は MVP では作らない（実機手動確認）。
- 決定論テストは「ゴールデンハッシュ」: 固定シードでイベント列を生成し、SHA-256 の先頭16桁を比較。
  ゴールデン値の更新は仕様変更時のみ。更新したら DECISIONS に1行残す。
- 実機でしか確認できない項目はテストではなく、STATUS の Notes に「手動確認済み」と記録。

## Git
- `main` 直コミットで可（個人開発）。1タスク1コミット `[P2-T4] 要約`。
- 生成物（`dist/`、`node_modules/`、カバレッジ）はコミットしない。`resources/atlas/*.bin` はコミットする（盤面ハッシュと対）。
