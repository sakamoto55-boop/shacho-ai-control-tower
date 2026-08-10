# LCC COMMAND 統合連携層（integrations）

夜間統合運転（2026-08-10）で追加したread-only連携基盤。全Sourceに対して読み取り専用（許可HTTP: GET/HEAD/OPTIONS + OAuth token交換POSTのみ）。

## 構成

- `common/` — 共通レコード封筒（`IntegrationRecord`）とimport inbox基盤。原則: UNKNOWNを0にしない / `sourceRecordUpdatedAt`（Source実更新）と `syncedAt`（取得時刻）を分離 / rawを保持し正規化値から原本へ追跡（Evidence + contentHash）
- `tkc/` — TKC会計の正式export（仕訳・試算表・元帳CSV/XLSX）importer。`data/import/tkc/inbox` へファイルを置くと検証→`data/normalized/tkc`→processed/rejected仕分け。公式APIは未確認のため画面スクレイピング等は行わない
- `freee/` — freee人事労務（勤怠）OAuth read-only connector。`FREEE_CLIENT_ID`/`FREEE_CLIENT_SECRET` 未設定=ADMIN_SETUP_REQUIRED、token未取得=AUTH_REQUIRED（認可URL生成）。tokenは `secure/freee-tokens.json`（Git外）
- `conversations/` — ChatGPT export（conversations.json）/ Gemini Takeout（MyActivity.json）のimporter。`data/import/conversations/<provider>/inbox` → `data/conversation_archive/<provider>/YYYY/MM/`（append-only・canonicalHash重複排除）。ブラウザ内部・非公開APIは扱わない

## 実行

```
npm run sync:all            # 全connector（lockで二重起動防止）
npm run sync:board          # ボード=LCC統合業務システムDB（既存Sheets SA・件数Evidence）
npm run sync:tkc            # TKC inbox処理
npm run sync:conversations  # 対話履歴export取り込み
npm run sync:freee          # freee認証状態の確認（READYなら以降の実装で実取得）
```

ログ: `logs/integrations/sync-YYYYMMDD.jsonl`（秘密情報・顧客名・トークンは出力しない）。

## 自動実行

`scripts/register-sync-task.ps1` がWindowsタスクを**無効状態**で登録する（READY_TO_ENABLE）。
有効化はLIVE_READ_ONLY・secret検証・スモーク完了後に社長承認を得て行う。

## Gitへ入れない（.gitignoreで強制）

`data/raw` `data/normalized` `data/import` `data/conversation_archive` `data/locks` `logs/` `secure/` — 顧客・会計・勤怠・会話の原本と実データはcommit禁止。
