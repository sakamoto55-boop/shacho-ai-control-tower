# CAPABILITY_MATRIX — 実データ質問Capability（Phase B1.5 §16）

作成日: 2026-08-08 / 判定はコード側 `src/command/domain/capability.ts`（`GET /command/capabilities`）と同期。
「現在のデータで完全回答できるか」の正直な整理。NOT_ANSWERABLE/PARTIALの質問に、
AIはそれらしい回答を作らず、不足データと接続後にできることを明示する（§17）。

前提: Service Account資格情報が未設定のため、本番モードは全Capabilityが実質未接続。
下表は「Service Account接続 + Sanity PASS後」の見込み判定。

| Capability | 判定 | 根拠 / 不足 |
| --- | --- | --- |
| 顧客検索 | **ANSWERABLE** | 統合業務システムDB customers（2,268件）接続で可 |
| 案件検索 | **ANSWERABLE** | 同 projects（2,459件）接続で可 |
| 見積・受注状況 | **ANSWERABLE / 実測確認** | projects内のestimate系列。金額0の移行行が多く、件数ベースは可・金額ベースは入力済み案件のみ |
| 粗利分析 | **PARTIAL** | 金額入力済み案件のみ。実績人工原価が未接続（DG-001/DG-003） |
| 今日の配置 | **NOT_ANSWERABLE** | デジタル配置板未稼働。実運用は物理ホワイトボード+写真AI読み取り（DG-002） |
| 昨日の実績日報 | **NOT_ANSWERABLE→PARTIAL候補** | 「日報データ（AI読み取り）」に実データあり。ただし確定運用が未完成で、確定行のみ実績に使える（DG-001） |
| 資金繰り（30/60/90日） | **NOT_ANSWERABLE** | 銀行残高未接続（DG-004）。回答には「完全な資金予測ではない」注記を必須とする |
| 未入金・回収 | **PARTIAL** | 請求発行側のみ。入金実績の記録場所が未確認（DG-006） |
| 目標比評価 | **PARTIAL** | 正式承認済み目標なし（DG-007）。Target Registry承認後にANSWERABLE |
| 月次損益・固定費 | **NOT_ANSWERABLE** | 会計未接続（DG-005） |

## Beta方針（§32）

配置・日報・銀行・会計の未接続はBeta全体の阻害条件にしない。
未接続CapabilityはPARTIAL/NOT_AVAILABLEとして明示し、接続済みCapabilityから段階的に利用開始する。

不足データの詳細・Evidence・推奨アクションは `src/command/domain/dataGaps.ts`（`GET /command/data-gaps`）が正。
