# SOURCE OF TRUTH MATRIX（TRACK B V1）

初期分類（REAL USE START指示による正本分類）。変更は社長承認のみ。

| # | Source | ID | 分類 | 用途 | 接続状態（2026-08-10） |
|---|--------|-----|------|------|------|
| 1 | LCC統合業務システムDB | `1jOU-Kq8v...G-16HY` | **CURRENT_SOURCE** | 顧客・案件正本（カンバンボード） | LIVE_READ_ONLY（customers 2,268 / projects 2,459。Vault取込4,825行） |
| 2 | LCCデジタル配置板DB | `1LLJTDr-g...HBVC8` | CURRENT_SOURCE / **MASTER ONLY** | 社員・車両・協力会社マスタ | 未取込（運用配置タブは現在空。マスタのみ対象） |
| 3 | LCC_CASE_DB | `1fU-QEnWn...hPaJs` | **DERIVED_SOURCE** | 法定書類管理のみ | AUTH_REQUIRED（SA閲覧共有未実施・403）。案件正本として重複取込しない |
| 4 | 日報データ（AI読み取り） | `19nu2Kzpr...a5MZ8` | CURRENT_SOURCE **CANDIDATE** | 日報ドラフト・写真AI読取 | LIVE_READ_ONLY（Vault取込3,539行）。**確定チェック済み行のみ実績候補・未確認行はDRAFT** |
| 5 | LINEWORKS受信箱 | `1T-aLFFNz...7NidM` tab:lineworks_inbox | **CURRENT EVIDENCE SOURCE** | LINE WORKSメッセージEvidence | AUTH_REQUIRED（SA閲覧共有未実施・403） |
| 6 | LCC People OS | `1E2U9opV2...DjwP` | CURRENT_SOURCE / **HIGH_SENSITIVE** | 給与・人事 | 未接続。給与個人実値を一般データVaultへ複製しない。外部LLM送信禁止 |
| 7 | AnyONE | - | **HISTORICAL** / RECONCILIATION | 過去の顧客・工事・請求 | NOT_STARTED（正式export待ち）。新しい正本に戻さない |
| 8 | TKC | - | ACCOUNTING SOURCE **CANDIDATE** | 会計仕訳・試算表 | LOCAL_IMPORT_READY（FX 49列仕訳CSV検証済み・inbox待ち） |
| 9 | freee | - | HR / ATTENDANCE SOURCE **CANDIDATE** | 勤怠・従業員 | ADMIN_SETUP_REQUIRED（アプリ未登録） |
| 10 | AI会話履歴 | - | **KNOWLEDGE ARCHIVE** | ChatGPT/Claude/Gemini会話 | LOCAL_IMPORT_READY（正式export待ち）。全会話をMemoryへ直接保存しない |

## 固定原則（変更禁止）

- 全Source初期READ ONLY。原本へ書き戻さない（Sheets API GETのみ）
- Source of Truthは領域ごとに1つ。名前だけで自動統合しない
- UNKNOWNを0へ変えない。取得日時（syncedAt）とSource更新日時（sourceRecordUpdatedAt）を分離
- raw IDを振り直さない。未承認status mappingを確定事実にしない
- 給与・マイナンバー・口座情報を外部LLMへ送らない
