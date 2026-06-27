# PRODUCTION_CONNECT_PLAN.md — 本番接続計画

> 実データ本番接続の手順・安全管理・費用・停止方法（確定版）  
> 2026-06-27

---

## 1. Google OAuth 本番接続

| 項目 | 内容 |
|------|------|
| 接続方式 | OAuth 2.0 Authorization Code + PKCE |
| Phase 11 スコープ | `gmail.readonly` のみ |
| 必要なもの | OAuth Client ID / Redirect URI |
| 設定手順 | `docs/GOOGLE_OAUTH_SETUP.md` |
| データ | 読み取りのみ（送信・削除・既読化なし）|

現状（v1.0.0 + Phase11）はフロントエンド直結で `gmail.readonly` を読み取り可能。  
ただし**本格運用にはバックエンドProxy を推奨**（理由は次項）。

---

## 2. バックエンドProxy が必要な理由

| 理由 | 説明 |
|------|------|
| client_secret の隔離 | SPA（ブラウザ）には secret を置けない。サーバー側でのみ保管 |
| トークンの安全保管 | localStorage は XSS リスク。HttpOnly Cookie でブラウザJSから隔離 |
| LINE WORKS 必須 | LINE WORKS は client_secret 必須 = フロントから直接接続不可 |
| ビルド時キー露出回避 | Vite の `VITE_*` はビルドに焼き込まれ公開される。Proxy なら回避 |
| 監査・レート制御 | アクセスログ・流量制御・将来の承認後実行の安全弁 |

```
[現状] ブラウザ → Google API（gmail.readonly のみ・secret不使用）
[目標] ブラウザ → バックエンドProxy → Google / LINE WORKS API
                    （secret はここだけ・HttpOnly Cookie）
```

---

## 3. Client ID / Secret 管理

| 種別 | 置き場所 | 公開可否 |
|------|---------|---------|
| OAuth Client ID | フロント `.env`（VITE_GOOGLE_CLIENT_ID）| 公開されうる（ID自体は秘密度低）|
| Google client_secret | **バックエンドのみ**（環境変数 / Secret Manager）| 絶対非公開 |
| Google refresh_token | バックエンドのみ | 絶対非公開 |
| LINEWORKS_CLIENT_SECRET | **バックエンドのみ** | 絶対非公開 |

ルール:
- `.env` はコミットしない（`.gitignore` 済み）
- 公開リポジトリのため、secret を README/コード/.env.example に書かない
- フロントの `.env` には Client ID と Redirect URI と readonly スコープのみ

---

## 4. LINE WORKS はバックエンド必須

LINE WORKS は **client_secret が必須**のため、フロントエンド単体では接続できません。

```
LINE WORKS 接続には必ず:
1. バックエンドサーバー（Node.js / Cloud Run 等）
2. LINEWORKS_CLIENT_SECRET をサーバー環境変数に設定
3. /api/lineworks/notifications 等の読み取り中継エンドポイント
4. 送信・返信・既読化は実装しない（読み取りのみ）
```

→ LINE WORKS（Mission 5）はバックエンドProxy（Phase 12）構築後に着手。

---

## 5. 本番接続順序

```
0. バックエンドProxy 構築（Mission 5/6 の前提）※Gmail単体なら省略可
1. Mission 1: Gmail（gmail.readonly）← 実装済・Client ID設定で稼働
2. Mission 2: Calendar（calendar.readonly）
3. Mission 3: Drive（drive.readonly）
4. Mission 4: Sheets（spreadsheets.readonly）
5. Mission 5: LINE WORKS（バックエンド必須）
6. Mission 6: 承認後実行（バックエンド + 監査ログ必須）
```

各段階で「読み取り接続 → 1週間検証 → 次へ」。

---

## 6. 費用発生ポイント

| ポイント | 課金 | 備考 |
|---------|------|------|
| GitHub Pages / Actions | 無料 | 公開リポジトリ |
| Google OAuth | 無料 | — |
| Gmail/Calendar/Drive/Sheets ReadOnly | 無料枠 | 通常運用で枠内 |
| バックエンド Cloud Run | **従量課金** | 起動時間・リクエスト数。小規模なら月数百円〜 |
| Secret Manager | **少額従量** | シークレット数・アクセス数 |
| OpenAI / Anthropic API | **従量課金** | `AI_PROVIDER` を実プロバイダにした場合のみ。現状 mock で未発生 |
| LINE WORKS | プラン次第 | 契約プランに準拠 |

**現状の発生費用：ゼロ。** 従量課金は Cloud Run / 実AI API を使い始めた時点から。

---

## 7. 安全停止方法（コスト即時ゼロ化）

| 止めたいもの | 操作 |
|------------|------|
| Gmail等の接続 | 設定画面「切断」→ トークン削除（デモに戻る）|
| 実AI API課金 | `AI_PROVIDER=mock` に戻す（既定値）|
| バックエンド課金 | Cloud Run サービスを停止/削除（min-instances=0 でも実質ゼロ）|
| Secret Manager | 不要シークレット削除 |
| GitHub 公開停止 | リポジトリを private に戻す（Pages停止・無料）|
| 全停止 | アプリはデモのまま稼働継続（外部接続なし＝課金なし）|

**重要**: 接続を切ってもアプリ自体はデモデータで動き続けます（壊れない）。
