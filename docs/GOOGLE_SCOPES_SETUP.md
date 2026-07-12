# GOOGLE_SCOPES_SETUP.md — Google接続 かんたん設定ガイド（初心者向け）

> 目的：Gmail / Calendar / Drive（＋できればSheets）を**実データ**にする。  
> すべて「読み取り専用」。送信・削除・変更は一切しません。費用もかかりません。  
> 所要時間：初回 約20〜30分（2回目以降は不要）

---

## はじめに（これだけ理解すればOK）

- やることは大きく2つだけです。
  1. **Google側**で「このアプリにデータを読ませてよい」と許可を作る（Cloud Console）
  2. **アプリ側**の `.env` に、もらった「鍵の名前（Client ID）」を貼る
- 入れるスコープ（読み取り範囲）は4つ。**すべて readonly（読み取りだけ）**：
  - Gmail / カレンダー / ドライブ / スプレッドシート
- うまくいくと、朝のチャットに `📡 データ：受信箱=実データ …` と表示されます。

> ⚠️ 迷ったら、まず **Gmail だけ**実データにして、慣れてから Calendar/Drive/Sheets を足してもOKです。

---

## パートA：Google Cloud Console の設定（画面の順番どおり）

ブラウザ（PC推奨）で https://console.cloud.google.com/ を開いてログイン。

### A-1. プロジェクトを作る
1. 画面上部の青いバーの**プロジェクト選択**（左上「▼」）をクリック
2. 右上「**新しいプロジェクト**」
3. プロジェクト名：`AI社長室` →「**作成**」
4. 作成後、もう一度上部でそのプロジェクトを選択

### A-2. 使うAPIを「有効」にする
左上「**≡ メニュー**」→「**APIとサービス**」→「**ライブラリ**」。
検索して、それぞれ開いて「**有効にする**」を押す（4回）：
- `Gmail API`
- `Google Calendar API`
- `Google Drive API`
- `Google Sheets API`

### A-3. OAuth同意画面を作る
左メニュー「**OAuth同意画面**」：
1. User Type：
   - 会社のGoogle Workspaceを使っている → 「**内部**」
   - 個人のGmail → 「**外部**」
   → 「作成」
2. アプリ名：`AI社長室`
3. ユーザーサポートメール：`sakamoto55@lcc55.com`
4. デベロッパー連絡先：`sakamoto55@lcc55.com`
5. 「保存して次へ」

### A-4. スコープ（読み取り範囲）を追加
同じ流れの「スコープ」ステップで「**スコープを追加または削除**」を押し、
検索ボックスで下を探してチェック（4つ）：
```
.../auth/gmail.readonly
.../auth/calendar.readonly
.../auth/drive.readonly
.../auth/spreadsheets.readonly
```
- ⚠️ 「**読み取り**」「**readonly**」と書かれたものだけ。
- ⚠️ `gmail.modify` `gmail.send` `calendar`（書き込み可）`drive`（書き込み可）は**選ばない**。
→ 「更新」→「保存して次へ」

### A-5. テストユーザーを追加（A-3で「外部」を選んだ場合のみ）
「テストユーザー」ステップで「**ADD USERS**」→ 社長のGmailアドレスを追加 →「保存」。
（これをしないと、後で「access_blocked」エラーになります）

### A-6. OAuthクライアントID（鍵の名前）を作る
左メニュー「**認証情報**」→「**認証情報を作成**」→「**OAuthクライアントID**」：
1. アプリケーションの種類：「**ウェブアプリケーション**」
2. 名前：`AI社長室 Web`
3. 「**承認済みのJavaScript生成元**」に追加：
   ```
   http://localhost:5173
   https://sakamoto55-boop.github.io
   ```
4. 「**承認済みのリダイレクトURI**」に追加（末尾の「/」まで正確に）：
   ```
   http://localhost:5173/
   https://sakamoto55-boop.github.io/shacho-ai-control-tower/
   ```
5. 「**作成**」→ 表示される「**クライアントID**」をコピー（メモ）

> 💡 「クライアントシークレット」も表示されますが、**このアプリでは使いません**。どこにも貼らないでください。

---

## パートB：.env に値を入れる（アプリ側）

`client/` フォルダで、見本ファイルをコピーして `.env` を作ります。

```bash
cp client/.env.example client/.env
```

`client/.env` をテキストエディタで開き、下記を埋めます（**空欄に貼るだけ**）：

```env
# ① Google から取得したクライアントID（パートA-6でコピーしたもの）
VITE_GOOGLE_CLIENT_ID=ここに貼る

# ② リダイレクトURI（ローカル開発なら下記のまま／本番URLなら差し替え）
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/

# ③ スコープ（4つ・このままコピーでOK・変更不要）
VITE_GOOGLE_SCOPES=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly

# ④ Sheets を実データにする場合だけ（任意・空欄ならデモのまま）
#    スプレッドシートURLの d/ と /edit の間の文字列がID。形式は docs/SHEETS_DATA_FORMAT.md
VITE_GOOGLE_SHEETS_SALES_ID=
VITE_GOOGLE_SHEETS_CASHFLOW_ID=
VITE_GOOGLE_SHEETS_PROJECT_PROFIT_ID=
VITE_GOOGLE_SHEETS_RECEIVABLE_ID=
VITE_GOOGLE_SHEETS_PAYABLE_ID=
```

> ⚠️ `.env` は Git に保存されません（`.gitignore` 済み）。鍵が外部に出ることはありません。
> ⚠️ Gmail/Calendar/Drive は①②③だけでOK。Sheetsは④を入れたシートだけ実データになります。

---

## パートC：接続する

1. アプリを起動（ローカル）：`cd client && npm run dev` → `http://localhost:5173/`
   （公開URLで使う場合は、Client IDを含むビルドのデプロイが別途必要）
2. 下の「**設定**」をタップ
3. 「**🔐 Googleアカウントで接続**」をタップ
4. Googleでログイン →「**続行/許可**」（4つの読み取りに同意）
5. 設定画面に戻る

> 🔁 **重要**：以前「Gmailだけ」で接続したことがある人は、
> 一度「**切断**」してから接続し直してください（古い許可だとCalendar/Drive/Sheetsが取得失敗になります）。

---

## パートD：接続できたか確認するチェックリスト

設定画面「**🛰️ SHOGUN データ接続状態**」を見る：

- [ ] Gmail：**実データ接続済み**
- [ ] Calendar：**実データ接続済み**
- [ ] Drive：**実データ接続済み**
- [ ] Sheets：**実データ接続済み**（IDを入れた場合）／ **設定不足**（IDなし＝デモのまま・正常）
- [ ] LINE WORKS：**デモ（バックエンド必須）** ← これは現状の正常表示

朝のチャット（AI相談を開く）で：

- [ ] 冒頭に「🌙 夜間レビュー」と「おはようございます、社長。」が出る
- [ ] 末尾の `📡 データ：` が
      `受信箱=実データ / 予定=実データ / ファイル=実データ / 数字=実データ(or未設定) / 通知=デモ`
- [ ] 最後が「**残りは私が監視します。**」で終わる

ここまで✅なら**実接続 完了**です。

---

## パートE：エラー時の原因表

| 画面の表示 / エラー | 原因 | 直し方 |
|--------------------|------|--------|
| Calendar/Drive が「取得失敗（要再接続）」 | 以前のGmailだけの許可が残っている | 設定で「切断」→ もう一度接続（4スコープに同意）|
| Sheets が「設定不足」 | シートID未設定 | `.env` の `VITE_GOOGLE_SHEETS_*` にIDを入れる（任意。空欄でも他は動く）|
| Sheets が「取得失敗」 | シートの列が想定形式と違う | `docs/SHEETS_DATA_FORMAT.md` の列順に直す |
| `redirect_uri_mismatch` | Console のURIと `.env` が不一致 | 末尾「/」まで完全一致させる（パートA-6とB②）|
| `access_blocked` / 「確認されていないアプリ」 | テストユーザー未登録（外部選択時）| パートA-5 で社長のGmailを追加 |
| `invalid_client` | Client IDが間違い | パートA-6のIDを正しく貼り直す |
| `idpiframe` / ポップアップが出ない | ブラウザのポップアップ/サードパーティ制限 | 別ブラウザ or 拡張機能オフで再試行 |
| すべて「デモ」のまま | 未ログイン or Client ID未設定 | パートB①とパートCを確認 |
| メールが0件 | 過去24時間に未読がない（仕様）| 正常。新着未読が来れば表示されます |

---

## 困ったとき

- まず **Gmailだけ**実データにして動作確認 → 慣れたら Calendar/Drive/Sheets を足す。
- 設定画面の「**認証ログを見る**」で、接続の成否（oauth_success / oauth_error）が確認できます。
- それでも不明なら、設定画面のスクショを開発側へ。状態表示から原因を特定できます。
