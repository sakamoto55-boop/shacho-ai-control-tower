# REAL_DATA_SOURCE_MAP — 実データ正本調査（Phase B0 → B1で実測完了）

作成日: 2026-08-08 / 状態: **実測調査完了（READ ONLY。5候補すべて実体確認済み）**

Phase B0時点でブロックされていたGoogle Drive READ ONLYアクセスがPhase B1で解除され、
5候補すべてのメタデータ・タブ構造・スキーマ・件数を実測した。
本ファイルにはスキーマと集計値のみを記録し、**個人情報（氏名・住所・電話・給与額）はリポジトリへ複製しない**。

## 正本分類（実測結果）

| # | 名称 | Spreadsheet ID / File ID | 分類 | 最終更新 |
| --- | --- | --- | --- | --- |
| 1 | LCC統合業務システムDB | `1jOU-Kq8vh7Meaa7auNQqVflseRAPCcGzksAsvG-16HY` | **CURRENT_SOURCE**（顧客・案件の正本） | 2026-07-20 |
| 2 | LCCデジタル配置板DB | `1LLJTDr-gAha0F3l5AaxbPUrYiQUA5QPKR0qRXbHBVC8` | **CURRENT_SOURCE**（社員・車両・協力会社マスタのみ。運用タブは現在空） | 2026-08-04 |
| 3 | LCC_CASE_DB | `1fU-QEnWnfE6AwWIV2wuiK1pERY5HbGPJ0GTMC0hPaJs` | **DERIVED**（統合業務システムからの派生。独自価値は法定書類管理のみ） | 2026-07-31 |
| 4 | ☆①LCC_経営管理_第13期_統合最終版 | `1W0Qhym5qCsbulfsKqaiFvn46xkR-H8vbZg8cybyQoPY` | **REFERENCE_ONLY**（シート自身が「仮値残存・経営判断に使うな」と明記。2026-04-01から更新停止） | 2026-04-01 |
| 5 | LCC_People_OS_統合マスタ_v17_正式ID給与条件反映.xlsx | `1E2U9opV2ucLtsXrsr6jXPvU8pL_iDjwP`（Drive上のxlsx） | **CURRENT_SOURCE・高機密**（給与・人事の正本。原本はLCC COMMANDへ複製しない） | 2026-07-26 |

Phase 1コードの `KintoneRepository` / `connectors/kintone.ts` は **LEGACY**（LCC COMMAND不参照）として確定済み。

## データ辞書（実測）

### 1. LCC統合業務システムDB（CURRENT_SOURCE）

- オーナー: sakamoto55@lcc55.com / 約351KB / 最終更新 2026-07-20
- 内部監査ログタブに実件数の記録あり: **顧客2,268件・案件2,459件**（2026-07-20 `lcc.html saveAll` 時点）。
  `docs/lcc.html`（LCC統合見積システム）が読み書きする正本DBであることがログから確認できた。
- タブ構造:

| タブ | 主キー | 主な列 | 実測件数 |
| --- | --- | --- | --- |
| customers | `cus_########` | id, name, kana, tel, address, note, kind(corp/person), referral, contactPerson, shortName, honorific, zip, pref, addr, building, fax, payTerms, invoiceNo, tags_json, boardId, createdAt, updatedAt | 2,268（監査ログ値。MCP表現では先頭111行のみ取得可） |
| projects | `prj_########` | id, customerId, name, site, tel, status(quote/contract…), kind(解体/外構/伐採/修繕/残置物/その他), receivedDate, estimateAmount/Tax/Total, cost, grossProfit, grossProfitRate, invoiceAmount/Total, estimateDate, orderDate, deliveryDate, invoiceDate, payTerms, payMethod, staff, boardId, boardNo, sellTotal, costBudget, labor, vehicle, disposal, subcon, material, approvals_json ほか計53列 | 2,459（監査ログ値。MCP表現では直近45行のみ取得可） |
| 日報（原価） | `dr_*` | id, projId, date, workers_json, vehicles_json, wastes_json, laborAmount, vehicleAmount, disposalAmount, totalAmount, memo | 2 |
| 請求書 | - | id, vendor, date, total, type, approved, projId, amount, lineId | 0（空） |
| 監査ログ | - | 日時, 操作者, アクション, 詳細 | 移行・保存履歴あり |

- ID体系: 顧客 `cus_` + 8桁 / 案件 `prj_` + 8桁 / `boardId` はID数値部と同値（配置板連携キー）。
  Canonicalへは `cust:<id>` / `prj:<id>` で取り込み、原文IDを `externalIds.sheet` に保持（振り直しなし）。
- 注意: 案件タブの金額列（estimateTotal/cost等）は移行由来で0のままの行が多い（見積システム側で金額確定済みの行のみ非0）。

### 2. LCCデジタル配置板DB（CURRENT_SOURCE・マスタのみ）

- 最終更新 2026-08-04（5候補中で最も新しい）
- タブ実測: 社員 **60行**（氏名・部署等の実名マスタ）/ 協力会社 **6行** / 車両 **27行** / 協力作業員 0行 /
  車両配置・段取り・現場・配置 **いずれも0行（運用データ未投入）** / 設定
- 判定: 社員・車両・協力会社の**マスタ正本**。配置・日報の運用タブは現在空のため、
  Schedule/DailyReport Sourceとしては「構造あり・データ未投入」= `PARTIAL` 扱い。

### 3. LCC_CASE_DB（DERIVED）

- タブ実測: `01_projects` **91行**・全行に注記「2026-07-31 統合業務システムから初期取込(受注のみ)」、
  `05_documents` **117行**（解体届出・石綿事前調査・マニフェスト等の法定書類、全行 doc_state=要確認）、
  イベントログ（取込provenance記録: 2026-07-30 import 91件 from 統合業務システムAPI）、コードマスタ（status/work_state/dept/doc_type）。
- `01_projects` は project_id / integrated_id / haichi_key / board_id のCrosswalk列を持ち、IDは統合業務システムと同一（`prj_` を再利用）。
  estimate_total / cost_budget はほぼ全行0（金額は取込対象外）。
- 判定: 案件データの正本は**統合業務システムDB**。LCC_CASE_DBの独自価値は**法定書類の期限管理**（05_documents）のみ。
  Project/Customer Sourceとしては接続しない（DUPLICATE回避）。将来「法定書類Source」として接続候補。

### 4. LCC_経営管理_第13期_統合最終版（REFERENCE_ONLY）

- ダッシュボード自体に警告文が明記されている:
  「均等割仮値が残っています…経営判断の参考資料としてお使いにならないよう」
- 2026-04-01以降更新なし（4か月停滞 = VERY_STALE）。
- 月次目標の**候補値**（未採用。ユーザー確認まで管理目標としては取り込まない）:
  解体課 26.3百万/月（年315.6百万）・地域支援課 11.1百万/月（年133.2百万）・不動産課 1.3百万/月（年15.6百万）。
- 判定: **REFERENCE_ONLY**。Management Target Sourceは、社長がこの値（または修正値）を正式確認するまで `not_configured` のまま。

### 5. LCC_People_OS_統合マスタ_v17（CURRENT_SOURCE・高機密）

- xlsx（Drive上、Sheetsネイティブではない）。2026-07-26更新。
- シート内に正本宣言あり: 「現在の正本：LCC People OS 統合マスタ v17。2026-07-26現在の在籍確認済：49名。入社予定：1名」。
- 構造: 00_新制度全体像 / 01_手当整理_決裁 / 02_給与明細モデル / 03_給与方式別設計 / 04_等級育成モデル /
  05_30日実行計画 / 06_経理・社労士確認 / 09_対象者・契約正本 / 10〜13_職務・等級・給与表・進捗 / 15〜23_People OS実装層。
- 取り扱い: **給与実値・個人条件はLCC COMMANDへ複製しない**（Learning Safetyで保存拒否）。
  利用するとしても部門別平均Cost Rate等の派生集計のみ（PRESIDENT層・SENSITIVE_REF設計、Phase B0設計のまま）。
  接続は `not_configured` を維持し、Cost Rate導出はユーザーの明示指示があるまで実装しない。

### 6. 日報データ（AI読み取り）（B1.5再調査で発見・配置/日報の実運用導線）

- Spreadsheet ID: `19nu2KzprKgf5NOLxsgh-TXaau0zkjisx3d19Eia5MZ8` / 最終更新 2026-08-07（毎日更新）
- タブ実測:
  - **配置板**: B1セルの日付で切り替わる当日ビュー（現場・発注元・区分・作業員・車両）。履歴を持たない
  - **日報データ**: 日付・現場・発注元・区分・作業員・**工数（人工）**・車両・**AI信頼度（低/中/高）**・
    **確認ステータス（未確認等）**・**確定（✔で転記対象）**・写真ファイル・取込日時・備考。2026-06〜の実データ行あり
- 運用実態（Evidenceに基づく判定）: 実運用は**物理ホワイトボード**で、毎日その写真
  （例:「８月8日「土曜日」作業日報17名…」）がDriveフォルダ `1TmY0FCOlv-…` へアップロードされ、
  AIが読み取って本シートの日報データへドラフト起票する。**配置板DBの運用タブが空である原因は
  「デジタル配置板は構築済み・未稼働（実運用が写真+AI読み取り経路）」**（分類: §7のC+Dハイブリッド。
  GAS「LCCデジタル配置板」は存在し2026-08-03更新）。
- 分類: **CURRENT_SOURCE候補（実績日報のドラフト正本）**。ただし確認ステータス未確認の行が多く、
  **確定（✔）行のみ**をDailyReportSourceの実績として扱う（未確認行を実績人工に使わない）。
  現場名→案件ID（prj_）の紐付けキーがない点はDG-003として管理。

## 接続優先順位への当てはめ（Phase B1 §3）

| 優先 | ドメイン | Source | 状態 |
| --- | --- | --- | --- |
| 1 | Project / Customer | 統合業務システムDB customers/projects | 列マッピング定義済み（`config/sheets.sources.example.json`）。**全量同期はSheets API資格情報待ち**（MCP表現は行数上限あり、部分データを全量として提示しない） |
| 2 | Estimate / Order | 同上 projects（estimate*/orderDate列） | 同上 |
| 3 | Cost | 同上 projects(cost系列) + 日報タブ | 同上（日報は現在2行） |
| 4 | Invoice / Payment | 同上（invoice列・請求書タブ） | 請求書タブは空。invoiceDate/invoiceTotal列で部分接続可 |
| 5 | Schedule / DailyReport | 配置板DB | タブ空のため `PARTIAL`（構造のみ） |
| 6 | Management Target | 経営管理第13期 | **ユーザー確認待ち**（仮値のため未採用） |
| 7 | Accounting | 未特定 | **ACCOUNTING_SOURCE = UNKNOWN**（推測しない） |
| 8 | Bank | 未特定 | **BANK_SOURCE = UNKNOWN**（資金繰り回答は「銀行残高未接続」を明示） |
| 9 | Cost Rate（給与派生） | People OS v17 | 高機密。ユーザー指示があるまで未接続 |

## サニティチェック方針（Phase B1 §4）

ソース側件数（監査ログ: 顧客2,268 / 案件2,459）とCanonical取込件数を `npm run command:sanity` で照合する。
MCP経由の部分スナップショット（顧客111行・案件45行）は全量と大きく乖離するため、
**照合が通るまで実データは会話へ提示しない**（現状は `DATA_UNAVAILABLE` / デモ明示のまま）。
全量同期にはGoogle Sheets API資格情報（`spreadsheets.readonly` のサービスアカウント推奨）が必要 — ユーザー作業。

## 会計・銀行（推測禁止領域）

- ACCOUNTING_SOURCE = **UNKNOWN** / BANK_SOURCE = **UNKNOWN**（実測でも該当ファイル未特定）。
- 資金繰り回答は「現在の銀行残高が接続されていないため、完全な資金予測ではありません」を明示する実装を維持。

## 接続実装の現状

- `SheetsSourceRegistry` + `RestSheetsClient`（Sheets API v4 values.get、GETのみ、timeout/retry/schema validation/freshness/provenance/errorState）
- `SnapshotSheetsClient`（READ ONLYエクスポートJSONで資格情報なしに検証する経路。Git管理外 `data/snapshots/`）
- 未設定Source（会計・銀行・目標・給与派生）は `not_configured` + `UNKNOWN` を明示し、デモデータへフォールバックしない。
