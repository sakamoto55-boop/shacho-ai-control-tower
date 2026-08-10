# SECURITY AND ACCESS（TRACK B V1）

## 資格情報

- Sheets: Service Account + `spreadsheets.readonly` 固定。資格情報は `.env`（GOOGLE_SERVICE_ACCOUNT_FILE / _JSON）のみ。Git・ログ・フロント露出禁止
- Anthropic/OpenAI/Gemini: `.env` のみ。キーの値・先頭・末尾を応答/ログ/レポートへ出さない（是正⑦で/providersからも排除済み）
- freee: 公式OAuth（Authorization Code + localhost callback）。tokenはGit外・OneDrive外・ログ非表示
- APIキー・token・Service AccountをGitへ入れない（.gitignore: `.env` / `secure/` / `data/raw` 等）

## アクセス制御

- `/command/providers` `/command/integrations` は認証必須 + RBAC（PRESIDENT/EXECUTIVE相当のみ）
- People OS（給与）はHIGH_SENSITIVE: 一般Vaultへ複製禁止・外部LLM送信禁止・PRESIDENT以外へ返さない
- Raw Vault実データは %LOCALAPPDATA%（Git外・OneDrive同期外）。レポート類は件数・状態のみ（PII・本文なし）

## 取得手段の制限（禁止事項）

- UIスクレイピング / Cookie・Local Storage取得 / 非公開API解析 / ログイン自動化 / 保存パスワード・端末バックアップ解析
- 個人LINEの直接取得（正式exportまたは人間転記 `external_forward` のみ）
- SourceへのPOST/PUT/PATCH/DELETE（唯一の例外はOAuth token交換のPOST）
- LINE WORKSへのメッセージ送信（本Phaseでは行わない）

## LLMコスト・情報制限

優先順: 決定論parser → schema mapping → ID/hash照合 → 必要レコードのみLLM抽出。
設定（env・既定は安全側）:

- `LCC_LLM_MAX_RECORDS_PER_SYNC`（既定0=同期処理でLLMを使わない）
- `LCC_LLM_MAX_TOKENS_PER_DAY`（既定0=無制限にしない）
- Source別利用可否: HIGH_SENSITIVE（People OS等）は常時禁止（コードで強制）
- PII（給与・マイナンバー・口座）は送信禁止

## 監査

- 同期ログ: logs/integrations/sync-YYYYMMDD.jsonl（件数・状態のみ。顧客名・本文・キーなし）
- LLM障害: observability llm_incident（providerStatus / reasonCode / occurredAt / retryable のみ）
