# REAL_DATA_SOURCE_MAP — 実データ正本調査（Phase B0）

作成日: 2026-08-08 / 状態: **調査ブロック中（Google Drive読み取りツールが承認待ち）**

本セッションのGoogle Drive MCPツールは全呼び出しが「requires approval」で拒否されるため、
シート実体（タブ・列・行数・更新日時）のREAD ONLY調査が実行できていない。
**推測で正本を確定しない方針に従い、全候補を UNKNOWN のまま保持する。**
承認が得られ次第、下記の調査手順を自動実行してこのファイルを実測値で更新する。

## 候補一覧（ユーザー提示 + 分類）

| # | 名称 | 種別 | Spreadsheet ID / ファイル | 分類 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| 1 | LCCデジタル配置板DB | Google Sheets | `1LLJTDr-gAha0F3l5AaxbPUrYiQUA5QPKR0qRXbHBVC8` | **UNKNOWN**（CURRENT_SOURCE候補） | 実体未確認。更新日時・タブ構造・アプリ参照の確認待ち |
| 2 | LCC統合業務システムDB | Google Sheets | `1jOU-Kq8vh7Meaa7auNQqVflseRAPCcGzksAsvG-16HY` | **UNKNOWN**（CURRENT_SOURCE候補） | 同上。Customer/Project/Estimate/Cost/Invoice相当タブの有無を要確認 |
| 3 | LCC_CASE_DB | Google Sheets | `1fU-QEnWnfE6AwWIV2wuiK1pERY5HbGPJ0GTMC0hPaJs` | **UNKNOWN**（#2とのDUPLICATE疑い要検証） | 「案件補助DB候補」。#2との重複・ID体系の関係が未確認 |
| 4 | ☆①LCC_経営管理_第13期_統合最終版 | Google Sheets | `1W0Qhym5qCsbulfsKqaiFvn46xkR-H8vbZg8cybyQoPY` | **UNKNOWN**（REFERENCE_ONLY候補） | 「第13期」表記。現行期の正式値か旧計画かの判定が必要。売上目標は複数値が出ても勝手に採用しない |
| 5 | LCC_People_OS_統合マスタ_v17_正式ID給与条件反映.xlsx | Excel on Drive | ファイル名検索で特定予定 | **UNKNOWN**（高機密） | 給与原本。LCC COMMANDへは複製せずCost Rate等の派生最小情報のみ設計（RBAC: PRESIDENT外へ原本非開示） |

Phase 1コードの `KintoneRepository` / `connectors/kintone.ts` は **LEGACY**（LCC COMMAND不参照）として確定済み。

## データ辞書テンプレート（候補ごとに実測で埋める）

```
ファイル名 / Spreadsheet ID / タブ一覧 / 各タブの列名 / 行数 / 更新日時（modifiedTime）
主キー候補 / customer_id / project_id / employee_id / データ型 / 空欄率 / 重複率
最新レコード日時 / 他DBとの関連候補（ID・名称の一致） / GAS・アプリからの参照有無
本番データらしさ（実在顧客名・連番の連続性・直近日付） / テスト・デモらしさ（ダミー名・丸い数値）
```

## 正本判定基準（ファイル名では決めない）

1. 現在更新されているか（modifiedTime・最新レコード日時）
2. 実データが入っているか
3. 現在の業務アプリ（配置板・統合業務システム）が参照しているか（GASコード・IMPORTRANGE）
4. ID体系が継続利用されているか
5. 類似DB（#2 vs #3）との関係
6. 過去版・バックアップではないか（「最終版」「v17」等の表記は根拠にしない）

判定できない項目はUNKNOWNのまま維持する。

## 調査の再開手順（承認後に自動実行）

1. `get_file_metadata` ×5（名称・modifiedTime・オーナー確認）
2. `read_file_content` で各タブのヘッダ・行サンプル取得（READ ONLY。書込系APIは使用しない）
3. データ辞書生成 → 本ファイル更新、分類確定（確定できないものはUNKNOWN維持）
4. 確定した正本のみ `LCC_SHEETS_SOURCES`（SheetSourceConfig）へ列マッピングを起こし、READ ONLY Adapterで接続
5. `GET /command/data-quality` の検出結果を `DATA_QUALITY_REPORT.md` へ反映

## ID体系（Crosswalk方針・実装済み）

- 既存IDは**変更しない**。Canonical側は `prj:<既存ID>` / `cust:<既存ID>` 形式で保持し、
  原文IDを `externalIds.sheet` に残す（`src/command/sources/canonicalMapping.ts`）。
- 複数DBで同一実体のIDが異なる場合は Crosswalk（Mapping Table）で対応し、新しい全社IDを振り直さない。
- 実際のID体系（案件番号形式・顧客コード形式・社員ID形式）は調査ブロック解除後に確定する。

## 会計・銀行（推測禁止領域）

- 会計システム: 現在利用中の証拠（Drive内の試算表・仕訳エクスポート・設定ファイル）未確認 → **ACCOUNTING_SOURCE = UNKNOWN**
- 銀行データ: CSV/明細ファイル/会計連携/手動シートのいずれも未確認 → **BANK_SOURCE = UNKNOWN**
- いずれもUNKNOWNのままPhase B0を停止しない（資金繰り回答は「銀行残高不明のため断定不可」を返す実装済み）。

## 接続実装の現状（実データ待ちで動作検証済み）

- `SheetsSourceRegistry` + `RestSheetsClient`（Sheets API v4 values.get、GETのみ、timeout/retry/schema validation/freshness/provenance/errorState）
- `SnapshotSheetsClient`（発見時にREAD ONLYエクスポートしたJSONで、クレデンシャルなしに会話検証する経路。Git管理外 `data/snapshots/`）
- 未設定Source（会計・銀行等）は `not_configured` + `UNKNOWN` を明示し、デモデータへはフォールバックしない。
