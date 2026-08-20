import { describe, expect, it } from 'vitest';
import { buildSeedDataset } from '../../src/command/data/seed.js';
import { summarizeProjects, summarizePersonnel } from '../../src/command/engines/rosterSummary.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('案件・人員サマリ（決定論・スコープ絞り込み・金額は確認済のみ）', () => {
  it('summarizeProjects: 状態別件数・進行中・金額確認カバレッジを集計する', () => {
    const dataset = buildSeedDataset(ASOF);
    const baseTotal = dataset.projects.filter((p) => p.companyId === 'lcc').length;
    dataset.projects.push(
      { projectId: 'prj-s1', companyId: 'lcc', customerId: 'c1', name: '受注A', stage: 'ordered', orderAmount: 1000000, estimateAmount: null, updatedAt: ASOF } as never,
      { projectId: 'prj-s2', companyId: 'lcc', customerId: 'c1', name: '未確認B', stage: 'unknown', orderAmount: null, estimateAmount: null, updatedAt: ASOF } as never
    );
    const s = summarizeProjects(dataset, 'lcc');
    expect(s.total).toBe(baseTotal + 2);
    // 追加した ordered は活動中に含まれる
    expect(s.activeCount).toBeGreaterThanOrEqual(1);
    // unknown は「状態未確認」ラベルで出る
    const unk = s.byStage.find((x) => x.stage === 'unknown');
    expect(unk?.label).toBe('状態未確認');
    expect(unk?.count).toBeGreaterThanOrEqual(1);
    // orderAmount=null は金額確認済に含めない（0円換算しない）
    const confirmed = dataset.projects.filter((p) => p.companyId === 'lcc' && p.orderAmount !== null && p.orderAmount !== undefined).length;
    expect(s.amount.confirmedCount).toBe(confirmed);
    expect(s.amount.coveragePct).toBe(Math.round((confirmed / s.total) * 100));
  });

  it('summarizeProjects: 別法人の案件はスコープで除外される', () => {
    const dataset = buildSeedDataset(ASOF);
    const lccTotal = summarizeProjects(dataset, 'lcc').total;
    dataset.projects.push({ projectId: 'prj-other', companyId: 'other-corp', customerId: 'c9', name: '他社案件', stage: 'ordered', orderAmount: 500, estimateAmount: null, updatedAt: ASOF } as never);
    // lccスコープでは他法人の案件は数えない
    expect(summarizeProjects(dataset, 'lcc').total).toBe(lccTotal);
  });

  it('summarizePersonnel: 社員数・役割内訳・協力会社数を集計する', () => {
    const dataset = buildSeedDataset(ASOF);
    const empBase = dataset.employees.filter((e) => e.companyId === 'lcc').length;
    dataset.employees.push(
      { employeeId: 'e-x1', companyId: 'lcc', name: '現場太郎', role: '現場監督' } as never,
      { employeeId: 'e-x2', companyId: 'lcc', name: '現場次郎', role: '現場監督' } as never
    );
    const s = summarizePersonnel(dataset, 'lcc');
    expect(s.employees).toBe(empBase + 2);
    const kantoku = s.byRole.find((r) => r.role === '現場監督');
    expect(kantoku?.count).toBeGreaterThanOrEqual(2);
    expect(s.vendors).toBe(dataset.vendors.filter((v) => v.companyId === 'lcc').length);
  });
});
