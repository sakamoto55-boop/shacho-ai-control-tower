# DATA_QUALITY_REPORT — データ品質報告（Phase B0）

作成日: 2026-08-08 / 状態: **実データ未接続のため実測値なし（検査基盤は稼働済み）**

Phase B0では不整合の**検出・報告のみ**を行い、自動修正は行わない（元データ無変更）。

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

## 実データの検査結果

**未実施**。Google Drive読み取りが承認待ちのため、実シートに対する検査は実行できていない。
承認後、正本確定 → READ ONLY接続 → 本レポートへ検出結果（件数・代表例・影響範囲）を追記する。

## 既知の構造リスク（接続前から予見される確認事項）

1. **配置 vs 日報**: 配置板の「予定」を実績人工として原価へ流し込まない（Canonicalモデルで
   `ScheduleAssignment`（予定）と `DailyReportEntry`（実績・人工）を分離済み）。
2. **案件ID横断**: 統合業務システムDBとLCC_CASE_DBが別ID体系の場合、Crosswalkが必要。
3. **売上目標の複数値**: 経営管理シートに複数の目標値がある場合は候補提示に留め、勝手に採用しない。
4. **給与情報**: People OSの給与原本はLCC COMMANDへ複製しない。原価計算にはCost Rate
   （職種・等級別の標準単価等）の派生最小情報のみを設計する（PRESIDENT外へ原本非開示）。
