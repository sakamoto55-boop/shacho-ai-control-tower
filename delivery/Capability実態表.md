# Capability実態表（2026-08-08検収時点）

分類: IMPLEMENTED=コード実装・自動テスト済み / CONFIGURED=接続設定済み / VERIFIED_BY_REAL_USE=実データ・実サーバーで動作確認済み / NOT_AVAILABLE=現在使えない

| Capability | 実態 | 根拠 |
|---|---|---|
| 経営読み取り会話（売上・危険案件・請求・検索・未来） | VERIFIED_BY_REAL_USE | 実データ100問評価102/102・Hallucination 0件 |
| 顧客・案件検索（実名） | VERIFIED_BY_REAL_USE | 顧客2,268件・案件2,459件で受入テスト |
| Memory（覚える・訂正・再起動後保持） | VERIFIED_BY_REAL_USE | 永続化テスト（停止→再起動→想起）PASS |
| 実LLM会話（Anthropic） | VERIFIED_BY_REAL_USE | 成功率100%・構造化100% |
| PPTX/XLSX/PDF生成 | VERIFIED_BY_REAL_USE | 実データから生成した実ファイルを納品 |
| 見積草案（金額は決定論） | VERIFIED_BY_REAL_USE | 実戦19問テスト |
| Growth日次観測・自己評価 | VERIFIED_BY_REAL_USE | Baseline記録済み |
| 会社憲法・目標の承認導線 | IMPLEMENTED | 実装・テスト済み。社長の承認操作が未実施 |
| Incident記録 | VERIFIED_BY_REAL_USE | 永続化テストで実登録・再起動後保持 |
| 図解SVG・アプリ化相談・外部調査下書き | IMPLEMENTED | 自動テストのみ（実運用使用はこれから） |
| 画像生成・音声・OpenAI/Gemini/Manus | NOT_AVAILABLE | APIキー未設定（設定で有効化・未設定は正常） |
| 銀行・会計・入金・日報の案件紐付け | NOT_AVAILABLE | ソース未接続（推測で補完しない設計） |
| 外部送信・支払・契約・本番Deploy | NOT_AVAILABLE | 設計上の禁止（承認必須+dry-run固定） |
