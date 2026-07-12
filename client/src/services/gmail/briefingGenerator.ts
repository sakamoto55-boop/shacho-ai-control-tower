// メールデータからAIブリーフィングを生成する構造
// mock ではなく実データから生成できる骨組み

import type { GmailMessage } from './types'
import { analyzeTaskType, analyzePriority, extractDeadline } from './gmailAnalyzer'

export interface GeneratedBriefing {
  greeting: string
  changes: Array<{ icon: string; text: string; type: 'danger' | 'warning' | 'info' }>
  topActions: string[]
  generatedFrom: 'real' | 'mock'
  messageCount: number
}

function greetingByHour(): string {
  const h = new Date().getHours()
  if (h < 11) return 'おはようございます。\n今朝のメール状況です。'
  if (h < 17) return 'お疲れ様です。\n現在のメール状況です。'
  return 'お疲れ様です。\n今日の残タスクを確認します。'
}

export function generateBriefingFromMessages(messages: GmailMessage[]): GeneratedBriefing {
  if (messages.length === 0) {
    return {
      greeting: greetingByHour(),
      changes: [{ icon: '✅', text: '新着メールはありません', type: 'info' }],
      topActions: ['今日の予定を確認してください'],
      generatedFrom: 'real',
      messageCount: 0,
    }
  }

  // 優先度・種類ごとに分類
  const priorityA = messages.filter((m) => analyzePriority(m) === 'A')
  const bankMails = messages.filter((m) => analyzeTaskType(m) === '銀行')
  const billingMails = messages.filter((m) => analyzeTaskType(m) === '請求')
  const contractMails = messages.filter((m) => analyzeTaskType(m) === '契約')
  const accidentMails = messages.filter((m) => analyzeTaskType(m) === '事故')

  const changes: GeneratedBriefing['changes'] = []

  if (priorityA.length > 0) {
    changes.push({
      icon: '🔴',
      text: `優先度A メール ${priorityA.length}件 — 本日中の判断が必要です`,
      type: 'danger',
    })
  }
  if (accidentMails.length > 0) {
    changes.push({
      icon: '⚠️',
      text: `事故・クレーム関連 ${accidentMails.length}件`,
      type: 'danger',
    })
  }
  if (bankMails.length > 0) {
    changes.push({
      icon: '🏦',
      text: `銀行・融資関連メール ${bankMails.length}件`,
      type: 'warning',
    })
  }
  if (billingMails.length > 0) {
    changes.push({
      icon: '💰',
      text: `請求・支払関連 ${billingMails.length}件`,
      type: 'warning',
    })
  }
  if (contractMails.length > 0) {
    changes.push({
      icon: '📝',
      text: `契約・署名待ち ${contractMails.length}件`,
      type: 'warning',
    })
  }
  if (changes.length === 0) {
    changes.push({
      icon: '📧',
      text: `新着メール ${messages.length}件 — 確認をお願いします`,
      type: 'info',
    })
  }

  // 上位アクション（優先度A → 銀行 → 請求 → その他の順）
  const sortedByPriority = [...messages].sort((a, b) => {
    const pa = analyzePriority(a)
    const pb = analyzePriority(b)
    const order = { A: 0, B: 1, C: 2 }
    return order[pa] - order[pb]
  })

  const topActions = sortedByPriority.slice(0, 3).map((m) => {
    const deadline = extractDeadline(m)
    const type = analyzeTaskType(m)
    const deadlineStr = deadline ? `（${deadline}）` : ''
    return `【${type}】${m.subject}${deadlineStr} — ${m.from}`
  })

  if (topActions.length === 0) {
    topActions.push('新着メールの内容を確認してください')
  }

  return {
    greeting: greetingByHour(),
    changes,
    topActions,
    generatedFrom: 'real',
    messageCount: messages.length,
  }
}
