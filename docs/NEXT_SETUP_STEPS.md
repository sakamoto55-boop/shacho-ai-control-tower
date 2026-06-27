# AI社長室 — 次に本番データへつなぐための手順

> Phase 11 準備ガイド  
> このドキュメントは、v1.0.0 のデモデータから実データへ切り替えるための手順です。

---

## 前提：Phase 11 で行うこと

```
v1.0.0（デモ）→ Phase 11（本番接続）

1. バックエンドProxy構築（Node.js / Cloud Run）
2. Google OAuth 本番接続（Gmail + Calendar 読み取りのみ）
3. Google Drive ReadOnly 本番接続
4. Google Sheets ReadOnly 本番接続
5. LINE WORKS本番接続（バックエンドProxy経由）
```

**⚠️ LINE WORKS だけはフロントエンドから直接接続できません。**  
バックエンドProxy が必須です（CLIENT_SECRET をフロントエンドに置けないため）。

---

## Step 1: Google Cloud Console の設定

### 1-1. プロジェクトを作成・確認

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. プロジェクトを作成または既存のプロジェクトを選択
3. 「APIとサービス」→「ダッシュボード」へ移動

### 1-2. 必要なAPIを有効化

以下のAPIを「有効にする」から有効化してください：

| API | 用途 |
|-----|------|
| Gmail API | メール読み取り |
| Google Calendar API | 予定読み取り |
| Google Drive API | ファイル読み取り |
| Google Sheets API | 経営数値読み取り |

### 1-3. OAuth同意画面の設定

1. 「OAuth同意画面」を開く
2. ユーザーの種類: **内部**（社内のみ使う場合）
3. アプリ名: `AI社長室`
4. スコープを追加（下記参照）

---

## Step 2: OAuth Client ID の設定

### 2-1. 認証情報の作成

1. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」
2. アプリケーションの種類: **ウェブアプリケーション**
3. 承認済みのリダイレクトURI に追加:
   - `http://localhost:5173/` （開発環境）
   - `https://sakamoto55-boop.github.io/shacho-ai-control-tower/` （本番）

### 2-2. Client ID をメモ

```
クライアントID: （取得後にここに記載）
※ クライアントシークレットはフロントエンドには使わない
```

---

## Step 3: 環境変数の設定

### フロントエンド（client/.env）

`client/.env.example` をコピーして `client/.env` を作成し、以下を設定します：

```env
# Google OAuth（必須）
VITE_GOOGLE_CLIENT_ID=取得したクライアントIDをここに記入
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/

# Phase 11 スコープ（Gmail + Calendar + Drive + Sheets 読み取り）
VITE_GOOGLE_SCOPES=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly

# Google Sheets スプレッドシートID（各スプレッドシートのURL末尾の文字列）
VITE_GOOGLE_SHEETS_SALES_ID=（売上スプレッドシートID）
VITE_GOOGLE_SHEETS_CASHFLOW_ID=（資金繰りスプレッドシートID）
VITE_GOOGLE_SHEETS_PROJECT_PROFIT_ID=（案件粗利スプレッドシートID）
VITE_GOOGLE_SHEETS_RECEIVABLE_ID=（未回収スプレッドシートID）
VITE_GOOGLE_SHEETS_PAYABLE_ID=（未払いスプレッドシートID）

# LINE WORKS（バックエンドのみに設定 — フロントエンドに書かない）
# VITE_LINEWORKS_CLIENT_ID=（バックエンド環境変数に設定）
# LINEWORKS_CLIENT_SECRET=（絶対にフロントエンドに書かない）
```

> ⚠️ `client/.env` は絶対に GitHub にコミットしないでください（`.gitignore` で除外済み）。

---

## Step 4: Gmail ReadOnly 接続

### 4-1. 設定画面から接続

1. AI社長室を開く
2. 下部ナビ「設定」をタップ
3. 「Googleアカウントで接続」ボタンをタップ
4. Googleアカウントでログイン
5. `gmail.readonly` スコープに同意

### 4-2. 接続確認

- 設定画面に「✓ 接続済み」が表示される
- AIコックピット・ホームに実メールのサマリーが表示される

### 取得されるデータ

- 未読メール（直近3日・最大10件）
- 件名・送信者・本文プレビュー
- 読み取り専用（送信・削除・既読化なし）

---

## Step 5: Calendar ReadOnly 接続

### 5-1. スコープを追加

`VITE_GOOGLE_SCOPES` に `calendar.readonly` を追加（Step 3参照）。

### 5-2. 接続確認

設定画面の Google 接続後、カレンダーデータが自動的に取得されます。

### 取得されるデータ

- 今日〜1週間の予定
- タイトル・開始時刻・場所
- 読み取り専用（予定作成・変更・削除なし）

---

## Step 6: Drive ReadOnly 接続

### 6-1. スコープを追加

`VITE_GOOGLE_SCOPES` に `drive.readonly` を追加（Step 3参照）。

### 6-2. 取得対象フォルダの設定

`client/src/services/drive/driveRegistry.ts`（今後作成予定）に  
対象フォルダのIDを設定します。

### 取得されるデータ

- 直近更新のファイル（最大20件）
- ファイル名・種類・更新日・オーナー
- ファイル内容は取得しない（メタデータのみ）

---

## Step 7: Sheets ReadOnly 接続

### 7-1. スプレッドシートIDの設定

Step 3の環境変数に各スプレッドシートのIDを設定します。

スプレッドシートIDはURLの末尾部分です：
```
https://docs.google.com/spreadsheets/d/【ここがID】/edit
```

### 7-2. 取得対象シートの確認

`client/src/services/sheets/sheetsRegistry.ts` で設定済みのターゲット：

| ターゲット | 内容 |
|-----------|------|
| 売上スプレッドシート | 月次売上・粗利データ |
| 資金繰りスプレッドシート | 13週キャッシュフロー |
| 案件粗利スプレッドシート | 案件別粗利率 |
| 未回収スプレッドシート | 売掛金・入金管理 |
| 未払いスプレッドシート | 買掛金・支払管理 |

---

## Step 8: LINE WORKS 本番接続（バックエンド必須）

> ⚠️ **LINE WORKS は他のサービスと異なりバックエンドProxy が必須です。**  
> フロントエンドから直接接続することはできません（セキュリティ上の理由）。

### 8-1. バックエンドProxy の構築

1. Node.js（Hono / Express）または Cloud Run でバックエンドを構築
2. バックエンドに以下の環境変数を設定（フロントエンドには書かない）:

```env
LINEWORKS_CLIENT_ID=（LINE WORKS Developer Console から取得）
LINEWORKS_CLIENT_SECRET=（絶対にフロントエンドに書かない）
LINEWORKS_DOMAIN_ID=（組織のDomain ID）
LINEWORKS_BOT_ID=（Bot ID）
LINEWORKS_CHANNEL_ID=（受信チャンネルID）
```

3. バックエンドエンドポイント例:
   - `GET /api/lineworks/notifications` — 通知一覧取得
   - `GET /api/lineworks/inbox` — 受信箱取得

### 8-2. フロントエンドの切り替え

`client/src/services/lineworks/lineworksClient.ts` の  
`DEMO_MODE` フラグを `false` にし、バックエンドURLを設定します。

---

## Phase 11 作業全体像

| 優先度 | タスク | 担当 |
|--------|--------|------|
| 1 | バックエンドProxy構築（Node.js / Cloud Run） | 開発 |
| 2 | Google OAuth 本番接続（Gmail + Calendar） | 開発 |
| 3 | Drive + Sheets ReadOnly 接続 | 開発 |
| 4 | LINE WORKS バックエンドProxy接続 | 開発 |
| 5 | 接続テスト（実データでの確認） | 開発 + 社長 |
| 6 | 本番デプロイ（バックエンド + フロント） | 開発 |

**目標**: Phase 11 完了で、実際のGmail・LINE WORKS通知が AI社長室に表示される状態になります。
