# 32 Training Check-in（スマホを持たないトレーニング）
開始時と終了時の**2回だけ前面で位置を取る**。背景の位置追跡はしない（PWA では不可, D-013）。
判定ロジックは `packages/claims/checkin`（純関数）、位置取得と Overpass 通信は `apps/web/platform`。

## 流れ
```
[開始] 「今からトレーニング」→ getCurrentPosition → 候補施設を一覧（近い順）→ 選ぶ →
       セッション保存 {sessionId, placeId, startAt, startAccuracyM}（生の座標は保存しない）。アプリは閉じてよい。
[終了] 「トレーニング終了」→ getCurrentPosition → 同じ施設の範囲内か判定 → 時間を計算 → 確認画面 → Grant
```
- 同時に開けるセッションは1つ。`getCurrentPosition({enableHighAccuracy: true, timeout: 15000, maximumAge: 0})`。
- `accuracy > 150m` なら「屋外に近づいて再取得」を促す（3回まで）。

## 施設の候補
| 種類 | 取得 | 範囲判定 | trust |
|---|---|---|---|
| 登録地点 | 利用者が「ここを◯◯として登録」（名前・種類・半径 既定 80m） | 中心からの距離 ≤ 半径 + accuracy | 0.8（`checkin-own`） |
| OSM 施設 | Overpass API（下記） | bbox を `accuracy + 30m` 広げた範囲内、bbox が無ければ中心から種類別半径 | 1.0（`checkin`） |
- Overpass クエリ（半径 300m、最大 50件）:
  `[out:json][timeout:10];nwr["leisure"~"^(fitness_centre|fitness_station|sports_centre|park|pitch|track|swimming_pool)$"](around:300,{lat},{lon});out tags center bb 50;`
  種類別の既定半径: fitness_centre 60m / sports_centre 120m / fitness_station 40m / その他 bbox 必須。
- 結果は約 500m 格子のセル単位で IndexedDB に 30日キャッシュ。公開サーバーの負荷に配慮し、1セッションで最大2回の問い合わせ。
  失敗・オフライン時は登録地点だけで判定する。エンドポイントは設定で変更可。
- 距離は正距円筒近似（`cos(lat)` を1回だけ計算）。claims は Core ではないので三角関数を使ってよいが、結果は純関数にする。

## 判定と報酬（spec/30 の checkin 行に合算）
| 条件 | 扱い |
|---|---|
| 終了地点が開始と同じ施設の範囲内、20分 ≤ 時間 | 成立。数える時間は最大 120分、60分以降は半分 |
| 20分未満 | 報酬なし（記録のみ） |
| 終了地点が範囲外 | 「施設外で終了」: 成立させない。自己申告に切り替えることはできる（trust 0.3、上限 60分） |
| 開始から 3時間で未終了 | 自動失効。「終了し忘れ」を自己申告（trust 0.3、上限 60分） |
| 初めての施設（OSM, 1日1回まで） | メダル +1 |

## プライバシー
- 生の緯度経度は保存しない（登録地点の中心のみ保存）。Overpass には問い合わせ時の座標だけが送られることを初回に説明。
- 位置情報の許可が拒否された場合は、チェックイン機能を無効化して自己申告のみにする。

## 実機で確認が必要（P0-T4）
- ホーム画面 PWA で位置情報の許可が毎回聞かれないか。屋内ジムでの `accuracy` の実測値（半径既定値の根拠）。
- `out tags center bb` の応答形式と、近所の施設が OSM に載っているか。
