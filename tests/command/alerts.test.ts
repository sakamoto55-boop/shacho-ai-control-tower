import { describe, expect, it } from 'vitest';
import { buildSeedDataset } from '../../src/command/data/seed.js';
import { buildAlerts, activeAlerts } from '../../src/command/engines/alerts.js';
import type { Decision } from '../../src/command/domain/types.js';

const ASOF = '2026-08-08T00:00:00.000Z';

function decision(overrides: Partial<Decision>): Decision {
  return {
    decisionId: 'dec-test',
    companyId: 'lcc',
    projectId: 'prj-a',
    date: '2026-08-01',
    decision: 'A案件は粗利より8/15完工を優先',
    reason: '顧客との完工約束を優先する',
    decisionMaker: '社長',
    validUntil: '2026-08-20',
    status: 'active',
    suppressAlertKinds: ['margin_drop'],
    ...overrides
  };
}

describe('アラート集約と経営判断Memory', () => {
  it('売上着地・粗利悪化・資金低下・営業漏れ・請求問題をアラート化する', () => {
    const dataset = buildSeedDataset(ASOF);
    const kinds = buildAlerts(dataset, 'lcc').map((alert) => alert.kind);
    expect(kinds).toContain('sales_landing_gap');
    expect(kinds).toContain('margin_drop');
    expect(kinds).toContain('cash_low');
    expect(kinds).toContain('inquiry_unanswered');
    expect(kinds).toContain('uninvoiced_completed');
  });

  it('売上着地アラートは目標比▲7.1%を含む', () => {
    const dataset = buildSeedDataset(ASOF);
    const alert = buildAlerts(dataset, 'lcc').find((item) => item.kind === 'sales_landing_gap')!;
    expect(alert.title).toContain('-7.1%');
    expect(alert.severity).toBe('WARNING');
  });

  it('有効なDecisionは対象アラートを抑制し、activeAlertsから除外する', () => {
    const dataset = buildSeedDataset(ASOF);
    const alerts = buildAlerts(dataset, 'lcc', [decision({})]);
    const marginAlert = alerts.find(
      (alert) => alert.kind === 'margin_drop' && alert.projectId === 'prj-a'
    )!;
    expect(marginAlert.suppressedByDecisionId).toBe('dec-test');
    expect(activeAlerts(alerts).some((alert) => alert.kind === 'margin_drop')).toBe(false);
  });

  it('期限切れのDecisionは抑制せず再評価する', () => {
    const dataset = buildSeedDataset(ASOF);
    const alerts = buildAlerts(dataset, 'lcc', [decision({ validUntil: '2026-08-07' })]);
    const marginAlert = alerts.find(
      (alert) => alert.kind === 'margin_drop' && alert.projectId === 'prj-a'
    )!;
    expect(marginAlert.suppressedByDecisionId).toBeUndefined();
  });

  it('別案件のDecisionは他案件のアラートを抑制しない', () => {
    const dataset = buildSeedDataset(ASOF);
    const alerts = buildAlerts(dataset, 'lcc', [decision({ projectId: 'prj-c' })]);
    const marginAlert = alerts.find(
      (alert) => alert.kind === 'margin_drop' && alert.projectId === 'prj-a'
    )!;
    expect(marginAlert.suppressedByDecisionId).toBeUndefined();
  });

  it('CRITICALを先頭に並べる', () => {
    const dataset = buildSeedDataset(ASOF);
    const alerts = buildAlerts(dataset, 'lcc');
    const severities = alerts.map((alert) => alert.severity);
    const order = { CRITICAL: 0, WARNING: 1, WATCH: 2, INFO: 3 } as const;
    const sorted = [...severities].sort((a, b) => order[a] - order[b]);
    expect(severities).toEqual(sorted);
  });
});
