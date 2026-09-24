# Archive: native-v1（iOS ネイティブ版の設計, 〜2026-09-24）
D-010 で React/TypeScript の PWA へ方針転換したため退避した。**エージェントは通常読まない。**
新 spec に移植済み: 決定論ルール・物理・Outcome Atlas（spec/20）、抽選・保留・パターン（spec/21）、
Engine/SimEvent/決定論契約（spec/22）、CueSheet と光過敏対策（spec/43）。
未移植（ネイティブ専用）: Live Activity・ウィジェット・AlarmKit・通知拡張・KeepAlive・CMPedometer。
ネイティブ版を再開する場合の起点。コードは P0-T1 で `archive/native-v1/` に移動する（commit 96f4fcb 時点）。
