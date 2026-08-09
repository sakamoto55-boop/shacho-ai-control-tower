# DATA_QUALITY_REPORT — データ品質報告（Phase B0 → B1で実測）

作成日: 2026-08-08 / 状態: **実データのREAD ONLY実測を実施（検出のみ・元データ無変更）**

Phase B0/B1では不整合の**検出・報告のみ**を行い、自動修正は行わない（元データ無変更）。
本レポートは集計値とID・構造の指摘のみを記録し、個人情報（氏名・住所・電話・給与額）は記載しない。

## 検査基盤（実装・テスト済み）

`src/command/domain/dataQuality.ts` の `checkDataQuality(dataset, scope)`。
API: `GET /command/data-quality?scope=<scope>`（RBAC適用）。

| 検出項目 | kind | 重さ |
| --- | --- | --- |
| 顧客名表記ゆれ（正規化後同一なのに複数ID） | customer_name_variant | WARNING |
| 顧客IDなし・無効な顧客参照の案件 | project_missing_customer | WARNING |
| 同名案件の重複疑い | project_duplicate | WARNING |
| 完工済みなのに完工日欠損（月次売上集計に影響） | completed_missing_date | WARNING |
| 見積の案件ID紐付け不能 | estimate_project_missing | WARNING |
| 受注見積額と案件受注額の不一致 | estimate_amount_mismatch | INFO |
| 請求の案件紐付け不能 | invoice_project_missing | WARNING |
| 日報と案件の紐付け不能（原価集計に使えない） | report_project_missing | WARNING |
| 日報の社員ID欠損 | report_missing_employee | INFO |
| 配置と案件の紐付け不能 | assignment_project_missing | INFO |

正規化ルール: 法人格（株式会社等）・空白・全角英数の差異を吸収して比較する。

## 実データの実測で確認した品質課題（2026-08-08、READ ONLY調査）

### 統合業務システムDB（顧客2,268件・案件2,459件）

1. **重複顧客**: 同一人物とみられる顧客が連番IDで2件登録されている例を確認
   （例: `cus_54317156` / `cus_54317158`。同姓同名・同住所）。→ customer_name_variant 検出対象。
2. **CSV列ずれ行**: 一部の顧客行でフィールドが1列ずれて格納されている
   （note列に住所断片が入る等、区切り文字起因とみられる）。取込時のスキーマ検証で `PARTIAL` として検出する。
3. **金額未入力の案件が多数**: 直近取得できた案件45行のうち44行が estimateTotal/cost/grossProfit すべて0
   （status=quote中心の移行データ）。金額確定済み案件のみが売上・粗利エンジンの入力になり得るため、
   **着地予測・粗利分析は金額入力済み案件の範囲でのみ有効**という注記が必須。
4. **請求書タブが空**: 請求・入金の正はprojects行内の invoiceDate/invoiceTotal 列のみ。入金実績列は未確認
   → Payment Sourceとしては不完全（期日超過未入金の実測は現状不可能。UNKNOWNとして扱う）。
5. **日報2行のみ**: 原価実績の日常入力はまだ始まっていない（2026-07-20の2件のみ）。

### 配置板DB

6. **運用タブが空**: 車両配置・段取り・現場・配置・協力作業員の各タブは0行。
   マスタ（社員60・車両27・協力会社6）のみ実データ。→ Schedule/DailyReport Sourceは `PARTIAL`。
7. **社員マスタの欠損**: 一部社員行で課（部署）欄が空欄。同姓同名または重複登録疑いが1件
   （B0メタデータ調査時に確認）。

### LCC_CASE_DB（派生）

8. **金額列がほぼ全行0**: 91案件中、estimate_total/cost_budget 非0は1行のみ（取込対象外のため）。
   このシートを金額系エンジンの入力にしてはならない（DERIVED判定の根拠）。
9. **法定書類117行が全行「要確認」**: 解体届出・石綿事前調査・マニフェストが自動生成のまま
   法務確認未了。期限（due_at）も全行空欄 → 期限アラートの元データとしてはまだ使えない。

### 経営管理第13期

10. **シート自身が仮値と明記**: 「均等割仮値が残っています…経営判断の参考資料としてお使いにならないよう」。
    かつ2026-04-01から更新停止（VERY_STALE）。→ 目標値はユーザー確認まで**不採用**。

## サニティチェック（Phase B1 §4）

`npm run command:sanity` で「ソース側件数 vs Canonical取込件数」を照合する。
現時点の判定: **NOT READY** — MCP経由で取得できるのは部分行（顧客111/2,268・案件45/2,459）のみで、
全量Canonical化にはSheets API資格情報が必要。照合が通るまで実データは会話へ提示しない
（LCC_COMMAND_MODE=production は `DATA_UNAVAILABLE` を返し続ける）。

## 既知の構造リスク（設計対応済み）

1. **配置 vs 日報**: 配置板の「予定」を実績人工として原価へ流し込まない（`ScheduleAssignment` と `DailyReportEntry` を分離済み）。
2. **案件ID横断**: 統合業務システムDBとLCC_CASE_DBは同一 `prj_` IDを共有（Crosswalk列 integrated_id / haichi_key / board_id を実測確認）。IDの振り直しは行わない。
3. **売上目標の複数値**: 経営管理シートの目標は候補提示に留め、勝手に採用しない。
4. **給与情報**: People OS原本はLCC COMMANDへ複製しない。派生はCost Rate最小情報のみ（PRESIDENT外へ原本非開示）。
