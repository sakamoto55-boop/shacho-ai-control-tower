import { describe, it, expect } from 'vitest'
import { computeOverdue } from './overdue'
import type { UnifiedInboxItem } from '../providers/providerTypes'

const NOW = Date.parse('2026-07-12T00:00:00Z') // JST 07-12 09:00

function mail(over: Partial<UnifiedInboxItem>): UnifiedInboxItem {
  return {
    id: 'x', source: 'gmail', providerType: 'inbox', from: 'a@b.com', fromName: 'A社',
    subject: '件名', bodyPreview: '本文', receivedAt: '2026-07-10T00:00:00Z', isRead: false,
    hasAttachment: false, labels: [], priority: 'A', taskType: 'メール', deadline: null,
    replyDraftAvailable: false, writeProtected: true, requiresApproval: true, ...over,
  }
}

describe('computeOverdue（期限超過判定）', () => {
  it('期限が過去のもののみ超過とし、超過日数を返す', () => {
    const r = computeOverdue([mail({ id: '1', deadline: '2026-07-10' })], NOW)
    expect(r).toHaveLength(1)
    expect(r[0].days).toBe(2)
  })

  it('期限なし・未来・当日は超過にしない', () => {
    const r = computeOverdue([
      mail({ id: '1', deadline: null }),
      mail({ id: '2', deadline: '2026-07-20' }),
      mail({ id: '3', deadline: '2026-07-12' }),
    ], NOW)
    expect(r).toHaveLength(0)
  })

  it('完了扱い（既読かつ下書きなし）は除外する', () => {
    const r = computeOverdue([
      mail({ id: '1', deadline: '2026-07-01', isRead: true, replyDraftAvailable: false }), // 完了扱い→除外
      mail({ id: '2', deadline: '2026-07-01', isRead: true, replyDraftAvailable: true }), // 未対応→残す
    ], NOW)
    expect(r.map((x) => x.item.id)).toEqual(['2'])
  })

  it('同一タスクを重複除外し、超過日数の降順に並べる', () => {
    const r = computeOverdue([
      mail({ id: '1', subject: 'A', deadline: '2026-07-11' }), // 1日
      mail({ id: '1', subject: 'A', deadline: '2026-07-11' }), // 重複
      mail({ id: '2', subject: 'B', deadline: '2026-07-05' }), // 7日
    ], NOW)
    expect(r).toHaveLength(2)
    expect(r[0].item.subject).toBe('B') // 超過日数が多い方が先
    expect(r[0].days).toBe(7)
  })
})
