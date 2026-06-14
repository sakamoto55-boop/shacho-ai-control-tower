# Info メール自動処理システム

## 何ができる仕組みか

`info@lcc55.com` 宛に届いたメールを AI（Gemini）が自動で読み取り、  
事務担当者が対応すべきメールだけを抽出して、以下を自動で行います。

- メール内容の要約（3行以内）
- 対応タスクの生成（次に何をすればいいかを具体的に提示）
- 返信コメント案の作成
- Google スプレッドシートへのタスク登録
- Gmail 上への返信下書き作成（送信はしない）
- LINE WORKS 事務用トークへの通知

**平日の朝8時・13時・16時** に自動チェックします。土日・祝日明けは前回チェック以降のメールをまとめて処理します。

> ⚠️ 自動送信は一切しません。送信はかならず担当者が確認・判断して行います。

---

## 事前に必要なもの

| 必要なもの | 用途 | 備考 |
|---|---|---|
| Google スプレッドシート | タスク・ログの保存先 | 新規作成して ID を控える |
| Google Apps Script | 自動化の実行基盤 | Google アカウントで無料利用可能 |
| Gemini API キー | AI 判定 | Google AI Studio から取得 |
| LINE WORKS Incoming Webhook URL | 通知送信 | LINE WORKS 管理画面から作成 |
| info@lcc55.com を読める Google アカウント | メール取得 | ※重要（下記参照） |

### ⚠️ Gmail の読み取り権限について（重要）

Google Apps Script は **実行者の Gmail アカウント** に届いているメールしか読めません。  
以下のいずれかを設定する必要があります。

**パターン A（推奨）**：`info@lcc55.com` のメールボックス本人として Apps Script を実行する  
→ `info@lcc55.com` の Google アカウントでスクリプトを作成・実行する

**パターン B**：実行アカウントの Gmail で `info@lcc55.com` を受信エイリアスに追加する  
→ Gmail 設定 →「アカウントとインポート」→「他のメールアドレスを追加」

**パターン C**：Google グループ経由  
→ Google グループに info@lcc55.com を設定し、実行アカウントもそのグループのメンバーにする

**返信下書きの差出人を `info@lcc55.com` にしたい場合**：  
Gmail 設定 →「アカウントとインポート」→「名前（他のメールアドレスとして送信）」に `info@lcc55.com` を追加する

---

## Script Properties の設定方法

1. Apps Script エディタを開く
2. 左メニューの「⚙️ プロジェクトの設定」をクリック
3. 「スクリプトプロパティ」タブをクリック
4. 以下のプロパティを1つずつ追加する

| プロパティ名 | 設定値 | 説明 |
|---|---|---|
| `GEMINI_API_KEY` | `AIza...` | Google AI Studio から取得した API キー |
| `LINEWORKS_WEBHOOK_URL` | `https://...` | LINE WORKS の Incoming Webhook URL |
| `SPREADSHEET_ID` | `1abc...` | スプレッドシートの URL 中の ID 部分 |
| `TARGET_EMAIL` | `info@lcc55.com` | 対象メールアドレス |
| `INTERNAL_DOMAIN` | `lcc55.com` | 社内ドメイン（内部メール除外に使用） |
| `DRY_RUN` | `true` | `true` = テストモード（下書き・通知しない） |

> スプレッドシートの ID は URL の `https://docs.google.com/spreadsheets/d/【ここ】/edit` の部分です。

---

## Gemini API キーの取得方法

1. [Google AI Studio](https://aistudio.google.com/) にアクセス
2. 右上「Get API key」→「Create API key」をクリック
3. 表示された `AIza...` から始まるキーをコピーして保存

---

## LINE WORKS Incoming Webhook の作成方法

1. LINE WORKS 管理画面（https://dev.worksmobile.com/）にログイン
2. 「Developer Console」→「Bot」→「Bot を追加」
3. Bot 名・説明を入力して作成
4. 「Webhook」タブ→「Incoming Webhook」を有効にする
5. トークルームに Bot を招待する
6. Webhook URL をコピーして `LINEWORKS_WEBHOOK_URL` に設定

---

## Apps Script の初回承認方法

初回実行時に Google のアクセス許可ダイアログが表示されます。

1. エディタから `setup()` を実行
2. 「このアプリは確認されていません」と表示されたら「詳細」→「安全でないページに移動」をクリック
3. 必要な権限（Gmail、スプレッドシート、外部リクエストなど）を「許可」する

---

## setup() の実行方法

1. Apps Script エディタを開く
2. 上部のドロップダウンで「`setup`」を選択
3. 「▶ 実行」ボタンをクリック
4. 「実行ログ」でエラーがないことを確認する

`✅` マークが表示されれば初期化成功です。

---

## DRY_RUN でのテスト方法

`DRY_RUN = true` の状態では以下のことをしません：
- Gmail 下書きを作成しない
- LINE WORKS に実際の通知を送信しない
- スプレッドシートには「DRY_RUN_DRAFT」と記録される

### テスト手順

```
1. showConfigStatus()     で設定が全て設定済みになっているか確認
2. testSheetInitialization() でシートが正しく初期化されているか確認
3. testGemini()           で Gemini API が応答するか確認
4. sendTestLineWorks()    で LINE WORKS に通知が届くか確認
5. manualRun()            で実際のメールを処理（スプレッドシートに記録）
```

各関数は Apps Script エディタの上部ドロップダウンから選択して実行できます。

---

## 本番化手順（DRY_RUN=false への変更）

1. `manualRun()` を数回実行し、スプレッドシートに正しいデータが入ることを確認
2. 返信下書きの内容が適切かを確認（下書きは DRY_RUN=true では作成されない）
3. 問題なければ Script Properties の `DRY_RUN` を `false` に変更
4. 再度 `manualRun()` を実行し、Gmail に下書きが作成されることを確認
5. LINE WORKS への通知が届くことを確認

---

## 毎日の運用方法

1. **LINE WORKS で通知を確認する**（平日の 8 時・13 時・16 時ごろ）
2. 通知の内容を見て優先度の高いタスクから対応する
3. **スプレッドシートでタスク詳細を確認する**（通知内のリンクから開く）
4. **Gmail で下書きを確認・編集して送信する**（Gmailリンクから開く）
5. 対応完了後、スプレッドシートの「ステータス」を「完了」に変更する

---

## トラブル時の確認方法

### LINE WORKS 通知が来ない

1. `sendTestLineWorks()` を実行して通知が来るか確認
2. `LINEWORKS_WEBHOOK_URL` が正しいか確認（`showConfigStatus()` で確認）
3. LINE WORKS の Bot がトークルームに招待されているか確認

### メールが処理されない

1. `showConfigStatus()` で全ての設定が「設定済み」か確認
2. `manualRun()` を実行してログを確認
3. `getConfig().lastSuccessMs` の値がおかしい場合は `resetLastSuccessMsForTest()` で初期化
4. Gmail の検索で `to:info@lcc55.com` が返ってくるか確認

### Gemini API エラー

1. `testGemini()` を実行してエラー内容を確認
2. `GEMINI_API_KEY` の値が正しいか確認
3. [Google AI Studio](https://aistudio.google.com/) でキーが有効か確認

### スプレッドシートに書き込まれない

1. `SPREADSHEET_ID` が正しいか確認
2. スプレッドシートに対する実行アカウントの編集権限があるか確認
3. `testSheetInitialization()` でシートが存在するか確認

### 処理が重複している（同じメールが2回登録される）

1. ログシートで同じ `メッセージID` の行が複数あるか確認
2. 処理ログのステータスが `TASK_CREATED` と `ERROR` 両方ある場合は正常（エラー後に再処理）

---

## clasp を使った管理方法（エンジニア向け）

```bash
# clasp をインストール
npm install -g @google/clasp

# Google アカウントでログイン
clasp login

# .clasp.json の scriptId を設定してからプッシュ
clasp push

# エディタで確認
clasp open
```

`.clasp.json` の `scriptId` は Apps Script エディタの URL から取得できます：  
`https://script.google.com/home/projects/【scriptId】/edit`

---

## ファイル構成

```
gas/
├── appsscript.json       # Apps Script マニフェスト（タイムゾーン・権限設定）
├── .clasp.json           # clasp 設定（scriptId を記入して使用）
├── Code.gs               # メインエントリーポイント（scheduledMain, manualRun）
├── Config.gs             # 設定取得・定数定義
├── GmailProcessor.gs     # Gmail 検索・本文取得・下書き作成
├── GeminiClient.gs       # Gemini API 呼び出し
├── SheetTaskRepository.gs # スプレッドシート操作
├── LineWorksNotifier.gs  # LINE WORKS 通知
├── Setup.gs              # 初期設定・テスト関数
├── README.md             # このファイル
├── TEST_PLAN.md          # テスト手順書
└── OPERATIONS.md         # 事務担当者向け操作マニュアル
```
