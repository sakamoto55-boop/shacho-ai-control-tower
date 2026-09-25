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

## 3. 既存freeeアプリの再利用（人事労務READ ONLY）

- 先にfreeeアプリストアの「マイアプリ」と「開発者ページ → アプリ管理」を照合する。ローカルの設定欠落はアプリ未登録の証拠ではない。同名の連携が複数ある場合、登録者・client ID・callback・認可範囲の対応を確認し、追加作成や既存連携の解除をしない。
- 既存アプリの `FREEE_CLIENT_ID` / `FREEE_CLIENT_SECRET` と単一の `FREEE_TOKEN_FILE` の保存先を確認する。秘密値をチャット・ログ・Gitへ貼らない。既存の設定を使い、別worktreeへtoken正本を複製しない。
- `FREEE_REDIRECT_URI` は登録済みcallbackと一致させる。このヘルパーは `http://127.0.0.1` のローカルcallback専用。コード既定値は `http://127.0.0.1:8790/freee/callback`。旧手順の `http://127.0.0.1:53682/callback` を登録済みなら環境変数でその値を指定し、勝手に登録を変えない。
- 必要な場合だけ `npx tsx scripts/freee-authorize.ts` を実行。認可の `state` を照合し、10分・1回限りでコードを受け付ける。アプリ・事業所・アクセス権を本人が確認して認可する。ブラウザーへのログイン、tokenファイルの存在、API疎通成功は別の状態として扱う。
- 取得前にHR APIの `GET /users/me` で事業所を照合し、LCCに対応する数値IDを `FREEE_COMPANY_ID` に設定する。Web画面の給与締め日グループID・アカウント管理番号を流用しない。未指定・認可対象との不一致では同期もVault保存も実行しない。先頭事業所を自動選択しない。
- 同期は従業員・勤怠等の既存GET連携。実行前に取得範囲と既存Vaultの保存先・アクセス制限を確認する。給与・賞与の実値は複製せず、freee側の給与確定・振込・従業員更新APIは呼ばない。freee会計や銀行明細の接続を意味しない。

仕様根拠：[freee認可手順](https://developer.freee.co.jp/startguide/getting-access-token)、[人事労務API](https://developer.freee.co.jp/reference/hr)。

## 4. ChatGPTデータエクスポート申請

- ChatGPT 設定→データコントロール→エクスポート→メールのZIPから `conversations.json` を
  `data/import/conversations/chatgpt/inbox/` へコピー（Gemini分はGoogle Takeoutで同様）

## 5. TKC月次データの正式出力を経理へ依頼

- 仕訳データCSV（FX形式・既に8,243行の検証済み実績あり）を毎月 `data/import/tkc/inbox/` へ

---
状態確認はいつでも: `npm run sync:all` → `GET /command/integrations`
