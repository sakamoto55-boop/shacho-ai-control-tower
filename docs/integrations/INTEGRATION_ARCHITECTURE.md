# INTEGRATION ARCHITECTURE（TRACK B V1）

## データ層の分離

```
[Source（正本・READ ONLY）]
   │ GETのみ（Sheets values.get / metadata.get、freee OAuth GET、正式exportファイル）
   ▼
1. Raw Vault           %LOCALAPPDATA%\LCC_COMMAND\vault\raw\<source>.jsonl
   （追記専用JSONL・IntegrationRecord封筒・contentHash sha256・checkpoint）
   ▼
2. Canonical Data      顧客・案件・人・車両・文書・メッセージの統一形式（V1は設計のみ・案件/顧客は既存Repository）
3. Entity Crosswalk    Source間ID対応（boardId/boardNo=CONFIRMED、一意値=HIGH、名称のみ=LOW→自動統合しない）
4. Evidence            IntegrationRecord.evidence（spreadsheet:ID + タブ!行 / ファイル+行）
5. Knowledge Index     文書・会話・議事録の検索索引（V1未実装・AI会話はConversation Archiveまで）
6. Persistent Memory   判断・好み・原則のみ（src/command/memory/。全レコードをMemoryへ入れない）
```

## 実装済みコンポーネント

- `src/command/integrations/common/types.ts` — IntegrationRecord封筒（sourceRecordUpdatedAt / syncedAt分離、contentHash、Evidence）
- `src/command/integrations/sheets/sheetsVaultSync.ts` — Sheets→Raw Vault（READ ONLY・idempotent・重複排除・checkpoint）
- `src/command/integrations/tkc/tkcImport.ts` — TKC正式export取込（FX 49列仕訳CSV対応・inbox/processed/rejected）
- `src/command/integrations/freee/freeeClient.ts` — freee公式OAuth（GETのみ・token Git外）
- `src/command/integrations/conversations/conversationImport.ts` — ChatGPT/Gemini公式export取込
- `scripts/sync-integrations.ts` — 同期ランナー（lock・retry・structured log・INTEGRATION_STATUS.json出力）
- `GET /command/integrations` — 接続状態・最終同期・件数・エラー（認証必須・秘密情報なし）

## 同期コマンド

`npm run sync:all | sync:sheets | sync:board | sync:lineworks | sync:anyone | sync:tkc | sync:freee | sync:conversations | sync:ai-history | sync:drive`

要件: read-only / incremental（contentHash重複排除） / idempotent / lock（data/locks/sync.lock・stale回収6h） / retry（Sheets 2回・指数バックオフ） / timeout（8s） / source別checkpoint / partial failure（Source単位で継続） / structured log（logs/integrations/・秘密情報なし）

## 保存基盤

- 最終target: PostgreSQL互換。現況: DATABASE_URL / Docker / psql いずれも無し → **DATABASE_INFRA_REQUIRED**
- 代替実装済み: append-only JSONL staging vault + contentHash + checkpoint（勝手なDB作成・インストールはしない）
- 実データはGit外・OneDrive外（%LOCALAPPDATA%\LCC_COMMAND\vault）

## Task Scheduler

`scripts/register-sync-task.ps1` は**無効状態で登録**する定義のみ（READY_TO_ENABLE。有効化は社長判断）。
