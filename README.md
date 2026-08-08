# 社長AI管制塔 Phase 1

会社メール、LINE WORKS、手入力された外部連絡をAI分析し、要約、タスク抽出、返信下書き、リスク判定、朝昼晩レポートを作るローカルMVPです。

> **LCC COMMAND（会話型AI経営管制OS）**: 経営者が自然言語で「今月どう？」「現金大丈夫？」と質問すると、決定論エンジンが社内データを計算し根拠付きで回答する上位レイヤーを `/command` 配下に実装しています。詳細・エンドポイント一覧は [LCC_COMMAND.md](./LCC_COMMAND.md)、UIは `docs/lcc-command.html` を参照してください。

このリポジトリは、最初からGmail、LINE WORKS、kintone、AI APIへ本番接続しません。Phase 1では、外部APIキーなしで動くローカルMVPを優先します。

## MVPの範囲

- メール・チャット本文の分析
- 1〜3行要約
- A/B/C優先度分類
- タスク抽出
- 担当者候補の判定
- 期限表現の抽出
- 返信要否判定
- 返信下書き作成
- クレーム、失注、粗利悪化、入金遅延、現場停止、人員不足、事故、契約、労務のリスク判定
- ローカルJSON保存
- 朝・昼・晩の社長向けレポート生成
- 将来的なGmail、LINE WORKS、kintone接続用のConnector設計

## やらないこと

- 個人LINE全トークの自動取得
- 個人LINEアプリのスクレイピング
- PC版LINEのRPA操作
- LINE通知の自動読み取り
- 私的会話のAI分析
- AIによる外部自動返信
- 金額、契約、納期の自動確定
- 社員の私的会話の分析
- 権限のないトークルームの読み取り
- 最初から全社員・全チャットを対象にすること
- 大規模な管理画面開発

個人LINE由来の業務連絡を扱う場合は、社長または担当者が必要な業務部分だけを `external_forward` として手入力・転記します。

## 技術スタック

- TypeScript
- Node.js 20+
- Hono
- ローカルJSON保存
- Vitest
- ESLint
- Prettier
- 将来的なCloud Run / Cloud Scheduler想定

## セットアップ

```bash
npm install
cp .env.example .env
npm run dev
```

起動後、以下でヘルスチェックします。

```bash
curl http://localhost:8787/health
```

## テスト・ビルド

```bash
npm test
npm run build
```

## 環境変数

主な環境変数は `.env.example` を参照してください。

Phase 1では以下だけで動きます。

```env
NODE_ENV=development
PORT=8787
ENABLE_DEV_ENDPOINTS=true
STORAGE_DRIVER=local
LOCAL_DB_PATH=./data/shacho-ai-local.json
AI_PROVIDER=mock
```

## APIエンドポイント

### GET /health

サービス状態を返します。

### POST /dev/analyze-text

任意の本文をAI分析し、保存せずにJSONを返します。

```bash
curl -X POST http://localhost:8787/dev/analyze-text \
  -H 'Content-Type: application/json' \
  -d '{
    "source":"manual_import",
    "senderName":"A社 田中様",
    "subject":"解体工事の見積依頼",
    "text":"A社から解体工事の見積を今日中に出してほしいと依頼。金額は概算でよいとのこと。"
  }'
```

### POST /dev/analyze-and-save

任意の本文をAI分析し、AI受信箱、AIタスク、返信下書きへ保存します。

```bash
curl -X POST http://localhost:8787/dev/analyze-and-save \
  -H 'Content-Type: application/json' \
  -d '{
    "source":"lineworks",
    "senderName":"工務部",
    "roomName":"現場配置・緊急対応ルーム",
    "text":"B現場で追加外注が必要。今日決めないと明日の作業が止まります。"
  }'
```

### GET /dev/inbox

保存されたAI受信箱を返します。

### GET /dev/tasks

保存されたAIタスクを返します。

### GET /dev/reply-drafts

保存された返信下書きを返します。

### POST /jobs/report/morning

朝レポートを生成します。

### POST /jobs/report/noon

昼レポートを生成します。

### POST /jobs/report/evening

夜レポートを生成します。

### POST /webhooks/lineworks

将来的なLINE WORKS Bot Webhook受信用です。Phase 1ではMockLineworksConnectorで正規化してローカル保存します。

## MessageSource

扱う `source` は以下だけです。

- `gmail`：会社メール
- `lineworks`：LINE WORKS業務チャット
- `manual_import`：社長または担当者による手入力
- `external_forward`：個人LINE、SMS、電話メモ等から必要部分だけを人間が転記したもの

## 優先度分類

- A：今日中に社長判断が必要
- B：担当者へ振れば進む
- C：記録のみ

Aの例：金額承認、値引き判断、クレーム、事故、現場停止、入金遅延、外注費追加、人員不足、失注リスク、契約条件、採用・退職・労務トラブル。

Bの例：見積作成、日程調整、資料送付、現場確認、通常問い合わせ、請求書確認、写真送付、社内確認依頼。

Cの例：完了報告、共有、参考情報、日常報告、既に対応済みの連絡。

## 自動送信禁止ルール

Phase 1では送信処理自体を作りません。返信下書きのみ生成します。

以下は将来的にも自動送信禁止です。

- 金額回答
- 値引き回答
- 契約条件
- 納期確約
- 謝罪文
- 責任認定
- クレーム対応
- 外注費承認
- 支払条件
- 入金督促
- 採用
- 退職
- 労務
- 事故
- 法的リスクがある内容

## ローカル保存

デフォルトでは `./data/shacho-ai-local.json` に保存します。

保存先は `Repository` interface で抽象化しています。

- `LocalRepository`：Phase 1の本命。ローカルJSON保存。
- `KintoneRepository`：将来接続用のスタブ。

## kintoneを使わない場合の運用

Phase 1では、APIで分析・保存・レポート生成まで確認します。kintone未経験でも動作検証できます。

確認順序：

1. `/dev/analyze-text` で分析精度を確認
2. `/dev/analyze-and-save` で保存確認
3. `/dev/inbox`、`/dev/tasks`、`/dev/reply-drafts` で保存結果確認
4. `/jobs/report/morning` でレポート確認

## 将来的なkintone接続案

kintoneは最初から社長が使う画面にせず、AI分析結果の台帳として使います。

想定アプリは3つです。

1. AI受信箱
2. AIタスク
3. 返信下書き

`src/connectors/kintone.ts` にフィールドコード定数とpayload変換を置いています。正式接続時は `KintoneRepository` を実装します。

## 将来的なGmail接続案

`src/connectors/gmail.ts` にConnector interfaceと正規化処理を置いています。

初期検索条件の候補：

- `newer_than:1d`
- `is:unread`
- 社長宛、社長CC
- 見積、請求、入金、支払、工事、解体、外構、依頼、至急、確認、クレーム、事故、追加、変更、キャンセル、契約

## 将来的なLINE WORKS接続案

`src/connectors/lineworks.ts` にWebhook正規化と送信mockを置いています。

初期対象ルーム候補：

- 社長AI管制塔
- 社長AI窓口
- 幹部ルーム
- 営業部ルーム
- 工務部ルーム
- 業務サポート部ルーム
- 現場配置・緊急対応ルーム

本番送信は最初はdry-runから始めます。

## Cloud Run / Cloud Scheduler想定

Cloud RunにはNode.js APIとしてデプロイします。Cloud Schedulerは以下のエンドポイントを朝昼晩に叩く想定です。

- `/jobs/report/morning`
- `/jobs/report/noon`
- `/jobs/report/evening`

本番化前に、Cloud Schedulerからの認証、devエンドポイント無効化、LINE WORKS送信dry-run解除を行います。

## セキュリティ注意事項

- APIキー、秘密鍵、トークンは `.env` またはSecret Managerで管理します。
- 本番APIキーをGitHubにpushしません。
- `ENABLE_DEV_ENDPOINTS=false` で `/dev/*` を無効化します。
- 個人LINEの全トーク取得はしません。
- 社員の私的会話は分析対象にしません。
- 最初から全社全チャットを対象にしません。
- AIは下書きまで。外部送信は人間承認を前提にします。

## 初期運用ルール

1. 最初は社長、業務サポート部、営業、工務、現場配置・緊急対応だけを対象にする。
2. 個人LINE由来の業務連絡は必要部分だけを手入力する。
3. 金額、契約、納期、謝罪、労務、事故は必ず人間確認にする。
4. 朝昼晩レポートは上位3〜5件に絞る。
5. 1週間は分析精度の確認に集中し、外部送信はしない。
