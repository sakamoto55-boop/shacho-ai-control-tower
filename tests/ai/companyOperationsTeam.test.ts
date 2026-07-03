import { describe, expect, it } from 'vitest';
import { reviewAsCompanyOperationsTeam } from '../../src/ai/team/companyOperationsTeam.js';
import { MockAIProvider } from '../../src/ai/providers/MockAIProvider.js';
import { fixtureMessages } from '../fixtures/messages.js';

describe('reviewAsCompanyOperationsTeam', () => {
  const provider = new MockAIProvider();

  it('見積依頼では営業担当が関連ありと判断する', async () => {
    const input = fixtureMessages.estimateToday;
    const result = await provider.analyzeMessage(input);
    const team = reviewAsCompanyOperationsTeam(input.text, result);

    const sales = team.reviews.find((r) => r.role === 'sales');
    expect(sales?.relevant).toBe(true);
    expect(team.leadRole).toBe('sales');
  });

  it('現場停止リスクでは工務担当とリスク管理担当が社長確認を要求する', async () => {
    const input = fixtureMessages.siteStop;
    const result = await provider.analyzeMessage(input);
    const team = reviewAsCompanyOperationsTeam(input.text, result);

    const construction = team.reviews.find((r) => r.role === 'construction');
    const riskOfficer = team.reviews.find((r) => r.role === 'risk_officer');
    expect(construction?.relevant).toBe(true);
    expect(construction?.requiresPresident).toBe(true);
    expect(riskOfficer?.requiresPresident).toBe(true);
  });

  it('クレームではリスク管理担当が人間確認を推奨し、自動確定しない', async () => {
    const input = fixtureMessages.complaint;
    const result = await provider.analyzeMessage(input);
    const team = reviewAsCompanyOperationsTeam(input.text, result);

    const riskOfficer = team.reviews.find((r) => r.role === 'risk_officer');
    expect(riskOfficer?.relevant).toBe(true);
    expect(riskOfficer?.requiresPresident).toBe(true);
    expect(riskOfficer?.recommendation).toMatch(/人間の確認/);
  });

  it('入金遅延では業務サポート担当が関連ありと判断する', async () => {
    const input = fixtureMessages.paymentDelay;
    const result = await provider.analyzeMessage(input);
    const team = reviewAsCompanyOperationsTeam(input.text, result);

    const backoffice = team.reviews.find((r) => r.role === 'backoffice');
    expect(backoffice?.relevant).toBe(true);
  });

  it('協力会社からの人員手配依頼では協力会社対応担当が関連ありと判断する', async () => {
    const input = fixtureMessages.partnerManpowerRequest;
    const result = await provider.analyzeMessage(input);
    const team = reviewAsCompanyOperationsTeam(input.text, result);

    const partner = team.reviews.find((r) => r.role === 'partner');
    expect(partner?.relevant).toBe(true);
  });

  it('完了報告のみの場合はどの担当も社長確認を要求しない', async () => {
    const input = fixtureMessages.doneReport;
    const result = await provider.analyzeMessage(input);
    const team = reviewAsCompanyOperationsTeam(input.text, result);

    const escalations = team.reviews.filter((r) => r.requiresPresident);
    expect(escalations).toHaveLength(0);
  });

  it('担当外事項しかない場合はteamSummaryにその旨が出る', () => {
    const result = {
      summary: '',
      projectName: '',
      customerName: '',
      priority: 'C' as const,
      replyNeeded: false,
      tasks: [],
      replyDraft: { needed: false, text: '', tone: 'confirmation_only' as const, confirmationNeeded: [], ngReasons: [] },
      risk: { type: 'none' as const, level: 'none' as const, reason: '明確なリスク表現は検出されませんでした。' },
      confidence: 'low' as const
    };
    const team = reviewAsCompanyOperationsTeam('特に業務に関係のない雑談です。', result);

    expect(team.reviews.every((r) => !r.relevant)).toBe(true);
    expect(team.teamSummary).toMatch(/担当外事項/);
  });
});
