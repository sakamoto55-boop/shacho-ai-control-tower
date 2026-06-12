import { describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/providers/MockAIProvider.js';
import { fixtureMessages } from '../fixtures/messages.js';

describe('MockAIProvider.analyzeMessage', () => {
  const provider = new MockAIProvider();

  it('returns the required JSON shape', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.estimateToday);
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('priority');
    expect(result).toHaveProperty('tasks');
    expect(result).toHaveProperty('replyDraft');
    expect(result).toHaveProperty('risk');
    expect(['A', 'B', 'C']).toContain(result.priority);
  });

  it('classifies estimate request as B and sales task', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.estimateToday);
    expect(result.priority).toBe('B');
    expect(result.replyNeeded).toBe(true);
    expect(result.tasks[0]?.ownerType).toBe('sales');
    expect(result.replyDraft.text).not.toMatch(/\d+円/);
  });

  it('detects site stop risk as A high risk', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.siteStop);
    expect(result.priority).toBe('A');
    expect(result.tasks[0]?.requiresPresident).toBe(true);
    expect(result.risk.type).toBe('site_stop');
    expect(result.risk.level).toBe('high');
  });

  it('detects complaint and avoids auto-send', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.complaint);
    expect(result.priority).toBe('A');
    expect(result.risk.type).toBe('complaint');
    expect(result.risk.level).toBe('high');
    expect(result.replyNeeded).toBe(true);
    expect(result.replyDraft.tone).toBe('apology_careful');
    expect(result.replyDraft.ngReasons.length).toBeGreaterThan(0);
  });

  it('detects payment delay', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.paymentDelay);
    expect(['A', 'B']).toContain(result.priority);
    expect(result.risk.type).toBe('payment_delay');
    expect(['medium', 'high']).toContain(result.risk.level);
    expect(result.tasks[0]?.ownerType).toBe('backoffice');
  });

  it('classifies completed report as C with no risk', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.doneReport);
    expect(result.priority).toBe('C');
    expect(result.replyNeeded).toBe(false);
    expect(result.risk.type).toBe('none');
    expect(result.tasks).toHaveLength(0);
  });
});
