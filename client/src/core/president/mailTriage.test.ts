import { describe, it, expect } from 'vitest'
import { triageActionMail } from './mailTriage'
import type { UnifiedInboxItem } from '../providers/providerTypes'

function mail(over: Partial<UnifiedInboxItem>): UnifiedInboxItem {
  return {
    id: 'x', source: 'gmail', providerType: 'inbox', from: 'tanaka@torihiki.co.jp', fromName: '田中',
    subject: '見積のご依頼', bodyPreview: 'お世話になります', receivedAt: '2026-07-11T00:00:00Z',
    isRead: false, hasAttachment: false, labels: [], priority: 'A', taskType: 'メール', deadline: null,
    replyDraftAvailable: false, writeProtected: true, requiresApproval: true, ...over,
  }
}

describe('triageActionMail（要対応メールのトリアージ）', () => {
  it('自動送信/no-reply は優先度を下げ、要返信にしない', () => {
    const r = triageActionMail([mail({ id: '1', from: 'no-reply@news.example.com', fromName: '配信' })])
    expect(r[0].deprioritized).toBe(true)
    expect(r[0].replyNeeded).toBe(false)
  })

  it('メルマガ/配信停止のキーワードを降格する', () => {
    const r = triageActionMail([mail({ id: '1', subject: '【メルマガ】今週の特集 配信停止はこちら' })])
    expect(r[0].deprioritized).toBe(true)
  })

  it('Gmailの広告カテゴリラベルを降格する', () => {
    const r = triageActionMail([mail({ id: '1', labels: ['CATEGORY_PROMOTIONS'] })])
    expect(r[0].deprioritized).toBe(true)
  })

  it('通常の優先度A未読は要返信になる', () => {
    const r = triageActionMail([mail({ id: '1' })])
    expect(r[0].replyNeeded).toBe(true)
    expect(r[0].deprioritized).toBe(false)
  })

  it('件名+送信者が同一のメールを重複除外する', () => {
    const r = triageActionMail([
      mail({ id: '1', subject: '同じ', fromName: '田中' }),
      mail({ id: '2', subject: '同じ', fromName: '田中' }),
    ])
    expect(r).toHaveLength(1)
  })

  it('要返信を自動送信より上に並べる', () => {
    const r = triageActionMail([
      mail({ id: '1', from: 'noreply@x.com', fromName: '通知', subject: '自動通知' }),
      mail({ id: '2', subject: '契約のご相談', fromName: '鈴木' }),
    ])
    expect(r[0].item.id).toBe('2') // 要返信が先
  })

  it('Gmail以外（LINE WORKS等）は対象外', () => {
    const r = triageActionMail([mail({ id: '1', source: 'デモLINE WORKS' })])
    expect(r).toHaveLength(0)
  })
})
