# STATUS
<!-- 30行以内を維持。古い Notes は削除してよい（履歴は git log にある） -->

- Current phase: P0 → `docs/plan/P0-bootstrap.md`
- Last done: P0-T4（位置情報と施設検索のスパイク。YOLP 補助＋登録地点主役を採用, D-025）
- Next: P0-T5（保存・音・描画性能のスパイク）
- Owner hint: Claude Code

## Blockers
- なし

## Notes（最新3件まで）
- P0-T4 実測: 位置の許可はホーム画面アプリでも起動のたびに聞かれる。accuracy は自宅（屋外・窓際）7〜17m。屋内ジムは未計測 → P4 で測る。
- P0-T4 実測: 公開 Overpass は 406/504・最大57秒で不採用。YOLP は 0.1〜0.2秒だが、近所の公園・ジムが API に無い → 登録地点を主役に（D-025）。
- P0-T4: YOLP は結果の保存禁止・JSONP・クレジット表示が必要（spec/32）。本実装前に Vercel に `VITE_YOLP_APPID` を設定する（人間）。
