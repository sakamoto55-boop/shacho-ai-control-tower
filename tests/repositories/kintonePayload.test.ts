import { describe, expect, it } from 'vitest';
import { toKintoneInboxPayload } from '../../src/connectors/kintone.js';
import type { InboxRecord } from '../../src/domain/types.js';

describe('kintone payload conversion', () => {
  it('converts inbox record to field-code payload', () => {
    const record: InboxRecord = {
      id: '1',
      source: 'manual_import',
      externalMessageId: 'm1',
      receivedAt: '2026-06-12T00:00:00.000Z',
      senderName: 'A社',
      senderAddress: '',
      roomName: '',
      subject: '',
      originalText: '見積お願いします',
      normalizedText: '見積お願いします',
      summary: '見積依頼',
      projectName: 'A社解体工事',
      customerName: 'A社',
      priority: 'B',
      replyNeeded: true,
      riskType: 'none',
      riskLevel: 'none',
      confidence: 'medium',
      status: 'draft_created',
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z'
    };

    const payload = toKintoneInboxPayload(record);
    expect(payload.source.value).toBe('manual_import');
    expect(payload.summary.value).toBe('見積依頼');
    expect(payload.replyNeeded.value).toBe(true);
  });
});
