# Conventions

## Swift
- Swift 6 言語モード・Strict Concurrency complete。警告ゼロを維持。
- Core の型は原則 `struct` + `Sendable` + `Codable`。`class` は Engine 等の状態保持のみ。
- `public` API には1行の doc コメント。内部実装にはコメント不要（意図が非自明な箇所のみ）。
- 単位は型名か変数名に入れる: `timeMs: Int64`, `posMM: Vec2`, `velMMs: Vec2`。
- 時刻は Core では `SimTime`（Int64 ミリ秒、UNIX epoch 基準）。`Date` は Core 外で変換。
- 浮動小数は `Double`。`Float` 禁止（決定論と精度）。
- 乱数は `RNGStream` 経由のみ。ストリーム ID は `RNGStreamID` enum で一元管理。

## ファイル
- 1ファイル1主要型。200行を超えたら分割を検討。
- Core のディレクトリ: `Math/ RNG/ Board/ Physics/ Atlas/ Machine/ Lottery/ Engine/ Projection/`
- JSON リソースは `Resources/` に置き、スキーマを spec に書く。キーは snake_case。

## テスト
- Swift Testing（`import Testing`、`@Test`、`#expect`）。XCTest は使わない。
- 決定論テストは「ゴールデンハッシュ」: 固定シードでイベント列を生成し、SHA256 の先頭16桁を比較。
  ゴールデン値の更新は仕様変更時のみ。更新したら DECISIONS に1行残す。
- 実機でしか確認できない項目はテストではなく、STATUS の Notes に「手動確認済み」と記録。

## Git
- ブランチは `main` 直コミットで可（個人開発）。1タスク1コミット `[P2-T4] 要約`。
- 生成物（.xcodeproj / DerivedData / atlas バイナリ以外のビルド成果物）はコミットしない。
- `Resources/atlas/*.bin` はコミットする（盤面ハッシュと対で管理）。
