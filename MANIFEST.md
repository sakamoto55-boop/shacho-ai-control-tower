# MANIFEST — LCC COMMAND DELIVERY v4（夜間最終走行反映版・DELIVERY CANDIDATE / AWAITING USER ACCEPTANCE）

- applicationCodeCommit: **b6c48b041cf2198446d231b59e668597c5060f92**（是正⑤=Windows起動是正まで含む。テスト430件PASS）
- artifactRendererCommit: b6c48b041cf2198446d231b59e668597c5060f92
- sourceSnapshotId: **snap-aaba8a1e3f**（3成果物すべて同一Snapshot Object・成果物ごとの再取得なし）
- previousSnapshotId: snap-df4dca5099
- previousSnapshotStatus: **HISTORICAL / SUPERSEDED FOR DELIVERY / NOT CURRENT ACCEPTANCE ARTIFACT SET**
- sourceRecordUpdatedAt（dataUpdated）: 2026-06-29T09:30:07.000Z
- syncedAt（取得時刻）: 2026-08-09T15:46:35.585Z（2026-08-10 00:46 JST）
- freshnessStatus: **VERY_STALE**（データ実更新から41日超。取得時刻をデータ更新時刻として表示しない。成果物の出所欄も「取得」表記へ統一）
- generatedAt: 2026-08-09T15:46:33.167Z
- customerCount: 2268 / projectCount: 2459
- productionMode: true / demoFallback: false / scope: lcc（株式会社LCC）
- 旧snapshotとの関係: **件数およびSource実更新日時は旧観測値と一致した。旧snapshotとのrow-level完全一致は検証不能**（旧生データ非永続化のため）

## 成果物3点 SHA-256

| ファイル | SHA-256 |
|---|---|
| LCC経営会議デッキ_snap-aaba8a1e3f_v4.pptx | 2813ca0e597e726aaff53f83c5ff43228c6cb5f21a117c02f75f6b302bf8b024 |
| LCC案件台帳_snap-aaba8a1e3f_v4.xlsx | d6c972a4b0ce1273080789b8bb3576b65a36ea9b92c5d31cb4738d18b1e5c09b |
| LCC経営報告_snap-aaba8a1e3f_v4.pdf | 6a1a51a788070d129fe798bc16b3366d97ea8dbc1ca9b47f8df867398dc3d07d |

- SNAPSHOT_EVIDENCE SHA-256: b3bc12c3ed80c84a7e6ea301682f00395db4e223327a643d32f30bd573f6e2a7（delivery/SNAPSHOT_EVIDENCE_snap-aaba8a1e3f.json。Sourceごとの行数・列数・列構成SHA-256・canonical content SHA-256を記録。顧客名・生セル値は不含）
- ZIP自身のSHA-256は本ファイルへ記載しない（外部sidecar `.zip.sha256` と `DELIVERY_RECEIPT` が正）

## KPI表（本Snapshot時点・Semantic Formatter準拠）

| KPI | value | confidence | 表示 |
|---|---|---|---|
| cash_balance（現預金） | null | UNKNOWN | 銀行未接続のため判定不能（0円ではありません） |
| sales_month（当月売上） | null | UNKNOWN | 会計・請求Source未接続のため判定不能（完工案件ベース参考値 0円＝別ラベルの参考値） |
| sales_landing（着地予測） | null | UNKNOWN | 算出不能（金額確認済0/91件・カバレッジ0%）。0円着地グラフは描画しない |
| order_backlog（受注残） | null | UNKNOWN | 算出不能（金額確認済0/91件・カバレッジ0%） |
| margin_forecast（予測粗利率） | null | UNKNOWN | 原価データ未接続のため算出不能 |
| uninvoiced（完工未請求） | null | UNKNOWN | 請求Source未接続のため判定不能 |
| sales_actions（営業対応） | 91 | MEDIUM | 「次工程未設定候補 91件（status=contractの意味確認待ち）」= PROVISIONAL・WATCH。確定した営業要対応と表現しない |
| alerts_today（本日の重大アラート） | 1 | HIGH | 銀行残高未取得の警告 |

## Status Semantics（変更なし・DATA_SEMANTICS_AUDIT.md準拠）

| 元status | 件数 | Canonical | 取り扱い |
|---|---|---|---|
| quote | 2,368 | unknown（ステータス未分類） | PROVISIONAL。追客中へ変換しない |
| contract | 91 | ordered（受注扱い・暫定） | PROVISIONAL。契約額未確認のため金額は全件不明扱い |

## 機械検査（独立スクリプト verify-delivery-artifacts.mjs による実ファイル検査）

- PASS 14件 / FAIL 0件 / UNVERIFIED 3件（PPTX・PDFの画像レンダリング目視=レンダラー不在、PDF日本語テキスト抽出=glyphエンコード。いずれもSpec検査+PPTX/XLSX実テキスト検査で代替し理由を記録）
- PPTX 11枚: 禁止文言0件・必須文言（算出不能/次工程未設定候補91件/2026-06-29/VERY_STALE/snapshotId）全件・着地チャート不在
- XLSX: 2,459+ヘッダー行・非表示シートなし・外部リンクなし・名前定義なし・受注額0円セル0件・旧snapshotId残存なし
- PDF: 3ページ・構造正常

## 是正履歴

- 是正⑤（adeed1d + b6c48b0）: Windows起動不具合（ESM起動ガード・BAT PIDブロック・UTF-8バッチ誤解析）
- 是正⑥（cbe6fa6）: 成果物再生成第1版（snap-a8bd8e3e57）とZIP標準化
- 夜間最終走行（本commit）: snap-aaba8a1e3fで再生成し、出所欄の「更新<取得時刻>」表記をdelivery生成処理で「取得」へ正規化（srcは無変更）。SNAPSHOT_EVIDENCEへcanonical content hash追加

## 未検証（ユーザー受入項目）

- Windows実機での start/stop bat: 開発側クリーン展開で起動停止×2回PASS済み。社長ご自身の操作による受入確認は未実施
- 実iPhoneからの接続（社長環境で確認）
