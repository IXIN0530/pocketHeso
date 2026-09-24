# P6 Presentation: 演出・音・光
配線（T1, T3）は Claude Code、演出シーン（T2）は Muse Spark。**T1 を T2 より先に行う**（シーンは CueSheet を描くだけにするため）。

### P6-T1 CueSheet 基盤
Owner: Claude Code | Read: spec/43-presentation-effects
Do: CueSheet 型（shared）、`CuePlayer`（途中から再生）、`SoundBus`（Web Audio・解錠）、`FlashLayer`（3回/秒クランプ・reduced-motion）、
`Haptics`、`resources/packs/default/pack.json`（最小キュー）。
Accept:
- [ ] 同じ seed で同じキュー列（テスト）/ 4回/秒を指定しても 3回/秒に抑えられるテスト

### P6-T2 演出シーン
Owner: Muse Spark | Read: spec/43-presentation-effects, spec/21-core-lottery（変動パターン節）, spec/50-app-rendering
Do: 液晶エリアの演出: 通常リーチ / SP / 激アツ（疑似連・群予告）/ 確定。図形・テキスト・パーティクルのみ。尺はパターンの `ms` に一致。
予告（赤保留・キリン柄）の見た目。
Accept:
- [ ] 同じ入力で同じ演出分岐（乱数ログ比較テスト）/ Debug の演出プレビューで4本が再生できる

### P6-T3 留守中リプレイと実機の音
Owner: Claude Code | Read: spec/22-core-engine（Projection 節）, spec/43-presentation-effects, ref/platform-limits
Do: AwaySummary の最も熱い当たりをリプレイ、実機での音量・消音スイッチ・フラッシュの確認。
Accept:
- [ ] 放置中に当たった演出を復帰後に再生でき、結果が Engine と一致
- [ ] platform-limits の音の欄を実測値で更新
