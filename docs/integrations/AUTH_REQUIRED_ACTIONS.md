# AUTH REQUIRED ACTIONS — 坂本社長の操作（最大5件）

AIでは代行できない認証・承認操作のみをまとめています。上から順で構いません。

## 1. Anthropic APIキーの発行（TRACK A完了の必須条件・最優先）

- ブラウザで開いた Anthropic Console でAPIキーを1個発行
- **この画面（チャット）には貼らず**、開いている黒いローカル入力ウィンドウへ貼り付けてEnter
- チャットには「発行できた」とだけ入力
- 閉じてしまった場合の再表示: `powershell -ExecutionPolicy Bypass -File C:\Users\sakam\AppData\Local\LCC_COMMAND_WORK\secure\enter-anthropic-key.ps1`

## 2. Sheets 2件をService Accountへ「閲覧者」共有（403解消）

対象（Googleスプレッドシートを開き「共有」→ SAのメールアドレスを閲覧者で追加）:

- **LINEWORKS受信箱** `1T-aLFFNzOGEIgnT6xsHcB5SxrVNJFYWZZi1Och7NidM`
- **LCC_CASE_DB** `1fU-QEnWnfE6AwWIV2wuiK1pERY5HbGPJ0GTMC0hPaJs`

（SAのメールアドレスは secure/sa.json の client_email。前夜の経理3シート共有と同じ手順）

## 3. freeeアプリ登録（勤怠READ ONLY接続の前提）

- freee開発者ページでアプリを作成（コールバック: `http://127.0.0.1:53682/callback`）
- Client ID / Client Secret を `.env` の `FREEE_CLIENT_ID` / `FREEE_CLIENT_SECRET` へ記入（チャットへ貼らない）
- 記入後 `npx tsx scripts/freee-authorize.ts` で認可URLが出るのでブラウザで1回承認

## 4. ChatGPTデータエクスポート申請

- ChatGPT 設定→データコントロール→エクスポート→メールのZIPから `conversations.json` を
  `data/import/conversations/chatgpt/inbox/` へコピー（Gemini分はGoogle Takeoutで同様）

## 5. TKC月次データの正式出力を経理へ依頼

- 仕訳データCSV（FX形式・既に8,243行の検証済み実績あり）を毎月 `data/import/tkc/inbox/` へ

---
状態確認はいつでも: `npm run sync:all` → `GET /command/integrations`
