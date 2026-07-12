import type { GmailMessage, GmailDerivedTask } from './types'
import { analyzeTaskType, analyzePriority, extractDeadline } from './gmailAnalyzer'

function buildSummary(msg: GmailMessage): string {
  return msg.snippet || msg.body.slice(0, 80).replace(/\n/g, ' ')
}

function buildRecommendedAction(msg: GmailMessage): string {
  const taskType = analyzeTaskType(msg)
  const priority = analyzePriority(msg)
  if (taskType === '銀行') return '銀行担当者に書類を準備して返信する'
  if (taskType === '請求') return '経理に支払状況を確認し、先方に連絡する'
  if (taskType === '契約') return '内容確認のうえ、署名・返送の日程を連絡する'
  if (taskType === '事故') return '状況確認・謝罪の連絡を即時入れる'
  if (priority === 'A') return '本日中に確認・返信する'
  return '今週中に確認・返信する'
}

function buildReplyDraft(msg: GmailMessage): string {
  const taskType = analyzeTaskType(msg)
  const fromName = msg.from.split(' ').slice(-1)[0] ?? msg.from

  if (taskType === '銀行') {
    return `${fromName}様\n\nお世話になっております。LCC株式会社 坂本でございます。\nご連絡いただきありがとうございます。\n\nご要望の件、承知いたしました。\n本日中に必要書類を準備してご送付いたします。\n\nよろしくお願いいたします。\n\nLCC株式会社 代表取締役 坂本`
  }
  if (taskType === '請求') {
    return `${fromName}様\n\nお世話になっております。LCC株式会社 坂本でございます。\nご連絡いただきありがとうございます。\n\n件の件につきまして、社内で確認のうえ今週中にご連絡いたします。\nご迷惑をおかけして申し訳ございません。\n\nよろしくお願いいたします。\n\nLCC株式会社 代表取締役 坂本`
  }
  if (taskType === '契約') {
    return `${fromName}様\n\nお世話になっております。LCC株式会社 坂本でございます。\nご確認のご連絡ありがとうございます。\n\n内容を確認し、今週中にご返送いたします。\nご不明な点がございましたらご連絡ください。\n\nよろしくお願いいたします。\n\nLCC株式会社 代表取締役 坂本`
  }
  return `${fromName}様\n\nお世話になっております。LCC株式会社 坂本でございます。\nご連絡いただきありがとうございます。\n\n内容を確認し、折り返しご連絡いたします。\n\nよろしくお願いいたします。\n\nLCC株式会社 代表取締役 坂本`
}

function extractKeywords(msg: GmailMessage): string[] {
  const keywords: string[] = []
  const text = msg.subject + ' ' + msg.body
  const candidates = ['銀行', '融資', '請求', '未払', '契約', '署名', '事故', '至急', '期限', '承認', '外注']
  for (const kw of candidates) {
    if (text.includes(kw)) keywords.push(kw)
  }
  return keywords
}

export function mapToGmailDerivedTask(msg: GmailMessage): GmailDerivedTask {
  return {
    id: `derived-${msg.id}`,
    gmailMessageId: msg.id,
    subject: msg.subject,
    from: msg.from,
    receivedAt: msg.date,
    summary: buildSummary(msg),
    priority: analyzePriority(msg),
    taskType: analyzeTaskType(msg),
    estimatedDeadline: extractDeadline(msg),
    recommendedAction: buildRecommendedAction(msg),
    replyDraft: buildReplyDraft(msg),
    relatedKeywords: extractKeywords(msg),
    source: 'gmail',
    writeProtected: true,
    replyStatus: '未送信',
    requiresApproval: true,
  }
}
