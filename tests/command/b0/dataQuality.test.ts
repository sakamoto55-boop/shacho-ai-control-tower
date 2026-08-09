import { describe, expect, it } from 'vitest';
import { buildSeedDataset } from '../../../src/command/data/seed.js';
import { checkDataQuality } from '../../../src/command/domain/dataQuality.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('B0: データ品質検査（検出のみ・自動修正なし）', () => {
  it('顧客名表記ゆれ・顧客ID欠損・完工日欠損・重複案件を検出する', () => {
    const dataset = buildSeedDataset(ASOF);
    dataset.customers.push({ customerId: 'cust-izumo-2', companyId: 'lcc', name: '出雲不動産' }); // 表記ゆれ
    dataset.projects.push(
      {
        projectId: 'prj-x1',
        companyId: 'lcc',
        customerId: '',
        name: '顧客不明案件',
        stage: 'in_progress',
        orderAmount: 1000,
        plannedMarginRate: 0.3,
        updatedAt: ASOF
      },
      {
        projectId: 'prj-x2',
        companyId: 'lcc',
        customerId: 'cust-ono',
        name: '完工日なし案件',
        stage: 'completed',
        orderAmount: 1000,
        plannedMarginRate: 0.3,
        updatedAt: ASOF
      },
      {
        projectId: 'prj-x3',
        companyId: 'lcc',
        customerId: 'cust-ono',
        name: 'A案件（出雲市 旧社屋解体工事）',
        stage: 'inquiry',
        orderAmount: 0,
        plannedMarginRate: 0,
        updatedAt: ASOF
      }
    );
    dataset.dailyReports.push({
      reportId: 'dr-x',
      companyId: 'lcc',
      date: '2026-08-07',
      siteName: 'どこかの現場',
      employeeName: '不明作業員',
      manDays: 1
    });

    const before = JSON.stringify(dataset);
    const issues = checkDataQuality(dataset, 'lcc');
    const kinds = issues.map((issue) => issue.kind);

    expect(kinds).toContain('customer_name_variant');
    expect(kinds).toContain('project_missing_customer');
    expect(kinds).toContain('completed_missing_date');
    expect(kinds).toContain('project_duplicate');
    expect(kinds).toContain('report_project_missing');
    // 自動修正しない（データセットは無変更）
    expect(JSON.stringify(dataset)).toBe(before);
  });

  it('健全なシードデータでは重大な不整合は検出されない', () => {
    const dataset = buildSeedDataset(ASOF);
    const issues = checkDataQuality(dataset, 'lcc');
    expect(issues.filter((issue) => issue.kind === 'customer_name_variant')).toHaveLength(0);
    expect(issues.filter((issue) => issue.kind === 'project_missing_customer')).toHaveLength(0);
  });

  it('法人スコープで絞って検査できる', () => {
    const dataset = buildSeedDataset(ASOF);
    dataset.customers.push({ customerId: 'cust-wel-2', companyId: 'wel', name: '出雲市（委託）' });
    const welIssues = checkDataQuality(dataset, 'wel');
    expect(welIssues.some((issue) => issue.kind === 'customer_name_variant')).toBe(true);
    const lccIssues = checkDataQuality(dataset, 'lcc');
    expect(lccIssues.some((issue) => issue.kind === 'customer_name_variant')).toBe(false);
  });
});
