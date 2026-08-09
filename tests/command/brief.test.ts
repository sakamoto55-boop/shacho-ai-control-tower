import { describe, expect, it } from 'vitest';
import { buildSeedDataset } from '../../src/command/data/seed.js';
import { generateExecutiveBrief } from '../../src/command/brief/generateBrief.js';
import type { Decision } from '../../src/command/domain/types.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('社長Brief', () => {
  it('確認が必要な件数・主要数値・推奨アクションを含む', () => {
    const dataset = buildSeedDataset(ASOF);
    const brief = generateExecutiveBrief(dataset, 'lcc');

    expect(brief.headline).toMatch(/本日は経営上\d+件確認が必要です。/);
    expect(brief.decisionsNeeded.length).toBeGreaterThan(0);
    expect(brief.text).toContain('おはようございます');
    expect(brief.text).toContain('現預金');
    expect(brief.text).toContain('【昨日からの変化】');
    expect(brief.text).toContain('【AI推奨アクション】');
    expect(brief.recommendedActions.some((action) => action.includes('完工未請求'))).toBe(true);
  });

  it('昨日からの変化に直近の原価計上を含める', () => {
    const dataset = buildSeedDataset(ASOF);
    const brief = generateExecutiveBrief(dataset, 'lcc');
    expect(brief.changes.some((change) => change.includes('営業接点'))).toBe(true);
  });

  it('Decisionで抑制した警告は件数として明示する', () => {
    const dataset = buildSeedDataset(ASOF);
    const decision: Decision = {
      decisionId: 'dec-1',
      companyId: 'lcc',
      projectId: 'prj-a',
      date: '2026-08-01',
      decision: 'A案件は粗利より完工を優先',
      reason: '完工約束',
      decisionMaker: '社長',
      validUntil: '2026-08-20',
      status: 'active',
      suppressAlertKinds: ['margin_drop']
    };
    const brief = generateExecutiveBrief(dataset, 'lcc', [decision]);
    expect(brief.alerts.some((alert) => alert.kind === 'margin_drop')).toBe(false);
    expect(brief.text).toContain('経営判断Memoryにより1件');
  });
});
