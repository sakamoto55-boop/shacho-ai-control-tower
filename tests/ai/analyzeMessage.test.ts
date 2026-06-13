import { describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/providers/MockAIProvider.js';
import { fixtureMessages } from '../fixtures/messages.js';

describe('MockAIProvider.analyzeMessage', () => {
  const provider = new MockAIProvider();

  // --- 既存テスト（後方互換） ---

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

  // --- chatHistory対応テスト ---

  it('[chatHistory] 社長が最後に発言した場合は返信不要と判定する', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.presidentLastSender);
    expect(result.replyNeeded).toBe(false);
    expect(result.replyDraft.needed).toBe(false);
    expect(result.replyDraft.ngReasons.some((r) => r.includes('社長'))).toBe(true);
  });

  it('[chatHistory] 相手が最後に発言した場合は返信必要と判定する', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.otherLastSender);
    expect(result.replyNeeded).toBe(true);
    expect(result.replyDraft.needed).toBe(true);
  });

  // --- 業種別テスト ---

  it('[建設] 外構工事の見積依頼はsalesタスクとして分類される', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.constructionEstimate);
    expect(['A', 'B']).toContain(result.priority);
    expect(result.replyNeeded).toBe(true);
    expect(result.tasks[0]?.ownerType).toBe('sales');
    // 予算感確認の文言が含まれること
    expect(result.replyDraft.text).toMatch(/予算/);
  });

  it('[解体] 近隣クレームはAリスクかつapology_carefulトーンになる', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.demolitionComplaint);
    expect(result.priority).toBe('A');
    expect(result.risk.type).toBe('complaint');
    expect(result.replyDraft.tone).toBe('apology_careful');
    expect(result.replyDraft.ngReasons.length).toBeGreaterThan(0);
  });

  it('[不動産] 入居申込は返信必要と判定される', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.realEstateInquiry);
    expect(result.replyNeeded).toBe(true);
    expect(['A', 'B', 'C']).toContain(result.priority);
  });

  it('[福祉] 利用者対応は社長判断が必要なタスクを生成する', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.welfareStaffReport);
    expect(result.replyNeeded).toBe(true);
    expect(['A', 'B']).toContain(result.priority);
  });

  it('[協力会社] 人員手配依頼はpartner_requestトーンになる', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.partnerManpowerRequest);
    expect(result.replyNeeded).toBe(true);
    expect(result.replyDraft.tone).toBe('partner_request');
  });

  it('[完了報告] 解体作業完了報告はタスク不要と判定される', async () => {
    const result = await provider.analyzeMessage(fixtureMessages.completionReport);
    expect(result.priority).toBe('C');
    expect(result.replyNeeded).toBe(false);
    expect(result.tasks).toHaveLength(0);
  });
});
