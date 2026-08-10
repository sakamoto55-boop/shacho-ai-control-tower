# AI HISTORY IMPORT（TRACK B V1）

## 対象と取得方法（公式exportのみ）

| Provider | 正式取得方法 | 配置先 |
|---|---|---|
| ChatGPT | 設定→データコントロール→エクスポート（メールでZIP）内の `conversations.json` | `data/import/conversations/chatgpt/inbox/` |
| Claude | claude.ai 設定→アカウント→データエクスポート | `data/import/conversations/claude/inbox/`（schema確認後に対応拡張） |
| Gemini | Google Takeout（MyActivity.json） | `data/import/conversations/gemini/inbox/` |
| Drive内会話まとめ | 既存のまとめドキュメント | Drive共有後にsync:driveで対応 |
| LCC COMMAND自身 | observabilityメタデータ（本文は保存しない方針を維持） | 対象外（メタのみ） |

禁止: browser Cookie / session token / Local Storage / 非公開API / 保存パスワード。

## Canonical Schema（conversationImport.ts実装済み）

`provider / conversationId / messageId / title / role / text / createdAt / projectId / attachmentRefs / sourceExport / contentHash / importedAt`

## 3層分離（全会話をMemoryへ直接入れない）

1. **Conversation Archive** — 全メッセージの原文アーカイブ（Git外・OneDrive外）
2. **Knowledge Index** — 検索用索引（V1未実装・次段）
3. **Memory Candidate** — 正式決定・ルール・Preference・Playbookのみを候補化し、Learning Safety検証を通す

Memory候補化しない対象: 雑談・一時的推測・未確認の噂・LLM推測・給与実額・マイナンバー・口座・医療相談内容。

## 手順（社長操作）

1. ChatGPT/Geminiのexportを申請しZIPを受領
2. ZIP内のjsonを上表のinboxへコピー
3. `npm run sync:ai-history` を実行（READ ONLY・重複はcontentHashで自動排除）
4. 結果は `GET /command/integrations` と同期ログで確認
