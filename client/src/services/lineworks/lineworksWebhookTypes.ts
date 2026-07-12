// LINE WORKS Webhook 受信用型定義（将来実装）
// 現時点では型定義のみ。Webhookエンドポイントはバックエンドで管理する。
// フロントエンドからWebhook返信・送信は行わない。

export type LineWorksWebhookEventType =
  | 'message'
  | 'join'
  | 'leave'
  | 'postback'
  | 'message_changed'
  | 'message_deleted'

export interface LineWorksWebhookPayload {
  type: LineWorksWebhookEventType
  channelId: string
  userId: string
  timestamp: string
  content: LineWorksWebhookMessageContent | null
}

export interface LineWorksWebhookMessageContent {
  type: 'text' | 'image' | 'file' | 'sticker'
  text?: string
  fileId?: string
  fileName?: string
}

// 将来のWebhook受信フロー:
// 1. バックエンドがLINE WORKSからWebhookを受信
// 2. バックエンドがデータをDBに保存
// 3. フロントエンドがバックエンドAPIから読み取り（GET専用）
// 4. AI Engineが分析してUI表示
//
// Webhookへの返信・確認応答はバックエンドのみが行う
// フロントエンドからのWebhook返信は禁止
