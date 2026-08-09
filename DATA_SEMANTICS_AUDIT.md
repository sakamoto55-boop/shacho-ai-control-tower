# DATA_SEMANTICS_AUDIT — Source status意味監査台帳

対象: LCC統合業務システムDB `projects.status`（実測 2026-08-09・全2,459行）

原則: **意味監査が承認されるまで、raw statusを経営ステージへ確定変換しない**。
未承認の値は `stage: unknown / stageConfidence: PROVISIONAL` とし、営業パイプライン集計から除外して「ステータス未分類」として別表示する。

| raw value | 件数 | 実例（案件名） | 業務上の意味（推定・未確認） | 根拠 | 承認者 | status |
|---|---|---|---|---|---|---|
| `quote` | 2,368 | 株式会社矢田製作所　所有地草刈り工事 | 「見積段階」か「追客中」か不明。全体の96%を占めるため、誤った意味づけは全集計を汚染する | 列名`status`の値のみ。業務ヒアリング未実施 | （未承認） | **UNAUDITED — stage:unknown扱い** |
| `contract` | 91 | 山田邸外構工事 | 契約済（受注）と推定 | `orderDate`列と共起・件数が実受注規模と整合 | （未承認） | **PROVISIONAL — stage:ordered として採用中（暫定）** |

## 関連列の監査状況

| 列 | 採用状況 | 備考 |
|---|---|---|
| `estimateTotal` | estimateAmount（見積額）として採用。0は未入力=不明扱い | 契約額ではないため受注額に使わない |
| 契約確定額 | **列が存在しない** → orderAmount=null（金額不明） | sellTotal等は意味未監査のため不採用 |
| `updatedAt`（epoch millis） | sourceRecordUpdatedAt として採用 | Source側実更新時刻。取得時刻(snapshotFetchedAt)と分離 |
| `staff` | ownerName（担当表示名）として採用 | employeeマスタ接続後にemployeeIdへ正規化 |
| `progress` / `billingStatus` / `sellTotal` / `cost` / `grossProfit` | 未採用 | 意味監査未実施のため集計に使わない |

## 承認手順

社長または業務責任者が各行の「業務上の意味」を確認し、承認者欄に記名 → `config` の stageMap / 列マッピングを更新 → status を CONFIRMED へ変更。承認まではUIおよび全成果物で「ステータス未分類」「不明」表示を維持する。
