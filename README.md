# 社長AI管制塔 Phase 1

会社メール、LINE WORKS、手入力された外部連絡をAI分析し、要約、タスク抽出、返信下書き、リスク判定、朝昼晩レポートを作るローカルMVPです。

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
- SNS反響の見込み客化（事業判定、受注確度、見込み金額、追客タスク自動生成）
- SNS投稿カレンダーと投稿下書きの自動生成（景表法チェック付き・投稿は人が承認）
- 集客・収益レポート（パイプライン金額、受注率、未返信リード）
- 将来的なGmail、LINE WORKS、kintone接続用のConnector設計

## やらないこと

- 個人LINE全トークの自動取得
- 個人LINEアプリのスクレイピング
- PC版LINEのRPA操作
- LINE通知の自動読み取り
- 私的会話のAI分析
- AIによる外部自動返信
- SNSへの無承認の自動投稿
- SNSのDM・コメントへの自動返信
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

### POST /webhooks/sns/inquiry

SNSのDM・コメント・問い合わせフォームの反響を1件取り込みます。分析してAI受信箱、リード、一次対応タスク、返信下書きへ展開します。

```bash
curl -X POST http://localhost:8787/webhooks/sns/inquiry \
  -H 'Content-Type: application/json' \
  -d '{
    "channel":"instagram",
    "accountName":"@tanaka_home",
    "displayName":"田中",
    "area":"前橋市",
    "text":"空き家の解体をお願いしたいです。木造2階建て、約40坪です。今月中に見積が欲しいので現地を見に来ていただけますか。電話は090-0000-0000です。"
  }'
```

### POST /dev/sns/analyze-inquiry

SNS反響を保存せずに分析だけします。確度と返信下書きの精度確認用です。

### GET /dev/sns/leads

保存された見込み客（リード）を返します。

### GET /dev/sns/post-drafts

保存されたSNS投稿下書きを返します。

### POST /dev/sns/post-drafts/:id/approve

投稿下書きを承認します。景表法チェックで指摘が残っている下書きは承認できません。

### POST /jobs/sns/plan-posts

投稿カレンダーを組み、各コマの投稿下書きを生成します。既定は今日から7日分です。

```bash
curl -X POST http://localhost:8787/jobs/sns/plan-posts \
  -H 'Content-Type: application/json' \
  -d '{"fromDate":"2026-08-17","days":7,"channels":["instagram","google_business"],"area":"前橋市"}'
```

### POST /jobs/sns/follow-up

追客日を過ぎたリードに追客タスクを自動生成します。Cloud Schedulerから毎朝叩く想定です。

### POST /jobs/sns/publish-approved

承認済みかつ予定日を迎えた投稿を公開します。Phase 1は常にdry-runで、実際には投稿しません。

### POST /jobs/report/revenue

集客・収益レポート（パイプライン金額、受注率、未返信リード、投稿予定）を生成します。

## SNS集客・収益化の流れ

```
SNSのDM・コメント・フォーム
  → POST /webhooks/sns/inquiry
    → analyzeSnsInquiry（事業判定・受注確度・見込み金額・スパム判定）
      → AI受信箱（source=external_forward, originalChannel=sns）
      → リード（LeadRecord）
      → 一次対応タスク（hotは当日中）
      → 返信下書き（approvalStatus=waiting／人が確認して送信）

投稿側
  POST /jobs/sns/plan-posts → 投稿カレンダー＋投稿下書き（waiting）
    → 人が確認・承認（/dev/sns/post-drafts/:id/approve）
      → POST /jobs/sns/publish-approved（Phase 1はdry-run）

追客
  POST /jobs/sns/follow-up → 追客日を過ぎたリードにタスク生成（最大5回、その後は長期フォロー）
```

見込み金額は `src/domain/leadRules.ts` の `AVERAGE_ORDER_VALUE_YEN`（事業別の平均受注単価）に規模の係数を掛けた概算です。実績が溜まったら実際の平均受注単価へ差し替えてください。

## MessageSource

扱う `source` は以下だけです。

- `gmail`：会社メール
- `lineworks`：LINE WORKS業務チャット
- `manual_import`：社長または担当者による手入力
- `external_forward`：個人LINE、SMS、電話メモ等から必要部分だけを人間が転記したもの、およびSNS反響

SNS反響は `source=external_forward` かつ `originalChannel=sns` として記録します。どのSNSかは `LeadRecord.channel` に持ちます。

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
- SNSのDM・コメントへの返信（社外向けのため必ず人が確認）

SNS投稿についても、下書き生成までがAIの担当です。人が承認した投稿だけを `/jobs/sns/publish-approved` が扱い、Phase 1のコネクタは常にdry-runで実際には投稿しません。

## 広告表現のチェック

投稿下書きは `src/domain/snsContentRules.ts` の `checkAdCompliance` を通します。以下に該当すると `ngReasons` が付き、`approvalStatus=needs_revision` となって承認できません。

- 「必ず」「絶対」「100%」「完全に」などの断定表現
- 「日本一」「業界No.1」「地域No.1」などの最上級表現
- 「最安」「業界最安値」「格安」などの価格訴求
- 「〇〇円で対応します」のような価格の言い切り

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

集客まわりは以下を想定しています。

- `/jobs/sns/follow-up`：毎朝1回（追客タスク生成）
- `/jobs/report/revenue`：毎朝1回（集客・収益レポート）
- `/jobs/sns/plan-posts`：週1回（翌週分の投稿下書き生成）
- `/jobs/sns/publish-approved`：投稿時間帯に定期実行（Phase 1はdry-run）

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
6. SNS反響は「確度hot＝当日中に一次返信」だけを必ず守る。反響への返信速度が受注率に直結する。
7. SNS投稿は下書きを人が読んでから投稿する。写真は `mediaHint` の指示どおりに撮り溜めておく。
8. 見込み金額はあくまで概算。受注が10件ほど溜まったら平均受注単価を実績値へ更新する。
