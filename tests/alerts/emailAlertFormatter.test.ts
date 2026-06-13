import { describe, expect, it } from 'vitest';
import { formatEmailAlert, buildAlertSummary } from '../../src/alerts/emailAlertFormatter.js';
import type { StoredMessageBundle } from '../../src/domain/types.js';

function makeBundle(overrides: Partial<StoredMessageBundle['inbox']> = {}): StoredMessageBundle {
  return {
    inbox: {
      id: 'test-id',
      source: 'gmail',
      externalMessageId: 'ext-id',
      receivedAt: new Date(Date.now() - 3_600_000).toISOString(),
      senderName: '田中 太郎',
      senderAddress: 'tanaka@example.com',
      roomName: '',
      subject: 'テスト件名',
      originalText: 'テスト本文',
      normalizedText: 'テスト本文',
      summary: 'テストの要約です。',
      projectName: 'テスト案件',
      customerName: 'テスト顧客',
      priority: 'B',
      replyNeeded: true,
      riskType: 'none',
      riskLevel: 'none',
      confidence: 'medium',
      status: 'draft_created',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides
    },
    tasks: [
      {
        id: 'task-1',
        sourceInboxId: 'test-id',
        taskTitle: '確認対応',
        taskDetail: '詳細確認',
        ownerType: 'sales',
        ownerName: '',
        dueDate: null,
        dueDateText: '今週中',
        priority: 'B',
        projectName: '',
        customerName: '',
        nextAction: '電話確認',
        requiresPresident: false,
        status: 'todo',
        reason: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    replyDraft: undefined
  };
}

describe('formatEmailAlert', () => {
  it('returns empty-state message when no bundles', () => {
    const text = formatEmailAlert([], 'morning', new Date('2026-06-13T08:00:00+09:00'));
    expect(text).toContain('朝の部');
    expect(text).toContain('要対応メールはありません');
    expect(text).toContain('12:30');
  });

  it('includes bundle details in output', () => {
    const bundle = makeBundle({ priority: 'A', riskType: 'complaint', riskLevel: 'high' });
    const text = formatEmailAlert([bundle], 'noon', new Date('2026-06-13T12:30:00+09:00'));
    expect(text).toContain('昼の部');
    expect(text).toContain('[A]');
    expect(text).toContain('田中 太郎');
    expect(text).toContain('テスト件名');
    expect(text).toContain('クレーム');
    expect(text).toContain('HIGH');
  });

  it('shows ★新着 when inboxId is in newInboxIds set', () => {
    const bundle = makeBundle({ id: 'new-id', externalMessageId: 'ext-new' });
    const text = formatEmailAlert([bundle], 'morning', new Date(), new Set(['new-id']));
    expect(text).toContain('★新着');
  });

  it('shows ⏳未処理継続 when inboxId is NOT in newInboxIds set', () => {
    const bundle = makeBundle({ id: 'old-id', externalMessageId: 'ext-old' });
    const text = formatEmailAlert([bundle], 'morning', new Date(), new Set(['other-id']));
    expect(text).toContain('⏳未処理継続');
  });

  it('shows correct next slot for each slot', () => {
    const b = makeBundle();
    expect(formatEmailAlert([b], 'morning')).toContain('12:30');
    expect(formatEmailAlert([b], 'noon')).toContain('18:00');
    expect(formatEmailAlert([b], 'evening')).toContain('翌08:00');
  });

  it('sorts bundles by priority score (A before B)', () => {
    const bundleA = makeBundle({ priority: 'A', id: 'a', externalMessageId: 'a' });
    const bundleB = makeBundle({ priority: 'B', id: 'b', externalMessageId: 'b' });
    const text = formatEmailAlert([bundleB, bundleA], 'morning');
    expect(text.indexOf('[A]')).toBeLessThan(text.indexOf('[B]'));
  });
});

describe('buildAlertSummary', () => {
  it('counts correctly', () => {
    const a = makeBundle({ priority: 'A', riskType: 'accident', riskLevel: 'high', replyNeeded: true });
    const b = makeBundle({ priority: 'B', riskType: 'none', riskLevel: 'none', replyNeeded: false });
    const c = makeBundle({ priority: 'C', riskType: 'none', riskLevel: 'none', replyNeeded: true });
    const summary = buildAlertSummary([a, b, c]);
    expect(summary.total).toBe(3);
    expect(summary.priorityA).toBe(1);
    expect(summary.priorityB).toBe(1);
    expect(summary.risks).toBe(1);
    expect(summary.replyNeeded).toBe(2);
  });
});
