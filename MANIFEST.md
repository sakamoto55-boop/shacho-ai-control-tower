# MANIFEST — LCC COMMAND DELIVERY v4（是正⑥=パッケージ整合反映版・DELIVERY CANDIDATE / AWAITING USER ACCEPTANCE）

- deliveryCodeCommit: **b6c48b0**（アプリ本体。是正⑤=Windows起動是正までを含む。テスト430件PASS）
- artifactRendererCommit: **b6c48b0**（成果物3点は本commitのSemantic Formatter/決定論エンジンで生成）
- artifactSourceSnapshotGeneratedByCommit: b6c48b0（旧記載「commit: 1958425」は旧snapshot生成元。是正⑥で成果物を再生成したため現行はb6c48b0）
- sourceSnapshotId: **snap-a8bd8e3e57**（3成果物すべて同一Snapshot Object）
- generatedAt: 2026-08-09T15:01:45.447Z（2026-08-10 00:01 JST）
- syncedAt（snapshotFetchedAt・取得時刻）: 2026-08-09T15:01:48.588Z
- dataUpdated（sourceRecordUpdatedAt・Source側レコード最終更新）: 2026-06-29T09:30:07.000Z
- freshnessStatus: **VERY_STALE**（データ実更新から41日超。取得時刻をデータ更新時刻として表示しない）
- scope: lcc（株式会社LCC）
- ソース件数: 顧客2,268件・案件2,459件（旧snapshot snap-df4dca5099 時点の記録件数・Source最終更新と一致。**全行完全一致の主張はしない**）
- 生成: 実データSourceのみ（Demo Fixture隔離済み・未接続領域は判定不能/未接続表示）。Sheets取得は生成時に1回のみ

## 成果物3点 SHA-256（是正⑥再生成）

| ファイル | SHA-256 |
|---|---|
| LCC経営会議デッキ_snap-a8bd8e3e57_v4.pptx | 6a80706103436cbe82932d54aa3fe45f6fd3774e47a0023c4abd9703b2ee8b22 |
| LCC案件台帳_snap-a8bd8e3e57_v4.xlsx | a1077e1fa9808aabe074ca7373936419ab850cd2a98f1871469bec69eed0c829 |
| LCC経営報告_snap-a8bd8e3e57_v4.pdf | a528667d6e433c807e3be7224c8cbf4b30be2324c188ae4adac2d42200ba7872 |

ZIP自身のSHA-256は本ファイルに記載しない（ZIP外のsidecar `.zip.sha256` と `DELIVERY_RECEIPT` が正）。

## KPI表（本Snapshot時点・Semantic Formatter準拠）

| KPI | value | confidence | 表示 |
|---|---|---|---|
| cash_balance（現預金） | null | UNKNOWN | 銀行未接続のため判定不能（0円ではありません） |
| sales_month（当月売上） | null | UNKNOWN | 会計・請求Source未接続のため判定不能（完工案件ベース参考値 0円＝別ラベルの参考値） |
| sales_landing（着地予測） | null | UNKNOWN | 算出不能（金額確認済0/91件・カバレッジ0%）。0円着地グラフは描画しない |
| order_backlog（受注残） | null | UNKNOWN | 算出不能（金額確認済0/91件・カバレッジ0%） |
| margin_forecast（予測粗利率） | null | UNKNOWN | 原価データ未接続のため算出不能 |
| uninvoiced（完工未請求） | null | UNKNOWN | 請求Source未接続のため判定不能 |
| sales_actions（営業対応） | 91 | MEDIUM | 「次工程未設定候補 91件（status=contractの意味確認待ち）」= PROVISIONAL候補・WATCH。確定した営業要対応と表現しない |
| alerts_today（本日の重大アラート） | 1 | HIGH | 銀行残高未取得の警告 |

## Status Semantics（変更なし・DATA_SEMANTICS_AUDIT.md準拠）

| 元status | 件数 | Canonical | 取り扱い |
|---|---|---|---|
| quote | 2,368 | unknown（ステータス未分類） | PROVISIONAL。追客中へ変換しない |
| contract | 91 | ordered（受注扱い・暫定） | PROVISIONAL。契約額未確認のため金額は全件不明扱い |

## 機械検査（是正⑥再生成後の実ファイル検査）

- PPTX（11枚）: 「着地予測: 算出不能（金額確認済0/91件・カバレッジ0%）」「受注残総額: 算出不能（同）」「次工程未設定候補 91件（status=contractの意味確認待ち）」を確認。0円表記はすべて「参考値/0円ではありません」の別ラベル付きのみ。禁止表現（着地予測0円・受注残0円・金額確認済0件(0円)）ゼロ
- XLSX: 2,459行＋メタデータ。snapshotFetchedAt（取得時刻）と sourceRecordUpdatedAt（Source実更新）を別項目で記録。2026-06-29を確認
- PDF: 同一snapshotId から生成
- 検査証跡: delivery/SNAPSHOT_EVIDENCE_snap-a8bd8e3e57.json

## 是正履歴

- 是正⑤（commit adeed1d + b6c48b0）: Windows起動不具合（ESM起動ガード・BAT PIDブロック・UTF-8バッチ誤解析）
- 是正⑥（本パッケージ）: 成果物3点を b6c48b0 コード + 新snapshot snap-a8bd8e3e57 で再生成（旧snap-df4dca5099の成果物は旧Semantic表示が残っていたため差し替え）。MANIFEST・受入チェックリスト・ZIP形式（UTF-8フラグ/スラッシュ区切り）是正

## 未検証（ユーザー受入項目）

- Windows実機での start/stop bat: 開発側クリーン展開で起動停止×2回PASS（是正⑤）。社長ご自身の操作による受入確認は未実施
- 実iPhoneからの接続（社長環境で確認）
