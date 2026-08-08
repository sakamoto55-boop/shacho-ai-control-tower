import { describe, expect, it } from 'vitest';
import { buildSeedDataset } from '../../src/command/data/seed.js';
import { computeSalesSummary } from '../../src/command/engines/sales.js';
import { detectSalesLeaks } from '../../src/command/engines/salesLeak.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('売上サマリエンジン', () => {
  it('当月売上着地が目標比▲7.1%になる', () => {
    const dataset = buildSeedDataset(ASOF);
    const sales = computeSalesSummary(dataset, 'lcc');

    expect(sales.confirmedSales).toBe(18_000_000);
    expect(sales.landingForecast).toBe(23_225_000);
    expect(sales.target).toBe(25_000_000);
    expect(sales.targetGapRate).toBeCloseTo(-0.071, 3);
    expect(sales.shortfall).toBe(1_775_000);
  });

  it('受注残とパイプラインを返す', () => {
    const dataset = buildSeedDataset(ASOF);
    const sales = computeSalesSummary(dataset, 'lcc');
    // prj-a 12M + prj-c 5.225M + prj-ord 1.8M
    expect(sales.orderBacklog).toBe(19_025_000);
    expect(sales.pipeline.length).toBeGreaterThanOrEqual(5);
    // 受注確度降順
    expect(sales.pipeline[0].probability).toBeGreaterThanOrEqual(
      sales.pipeline.at(-1)!.probability
    );
  });
});

describe('営業漏れ検知エンジン', () => {
  it('5種類の漏れをすべて検知する', () => {
    const dataset = buildSeedDataset(ASOF);
    const kinds = detectSalesLeaks(dataset, 'lcc').map((leak) => leak.kind);
    expect(kinds).toContain('inquiry_unanswered');
    expect(kinds).toContain('estimate_not_submitted');
    expect(kinds).toContain('no_follow_up');
    expect(kinds).toContain('stalled');
    expect(kinds).toContain('no_next_step');
  });

  it('問い合わせ未対応を最優先にする', () => {
    const dataset = buildSeedDataset(ASOF);
    const leaks = detectSalesLeaks(dataset, 'lcc');
    expect(leaks[0].kind).toBe('inquiry_unanswered');
    expect(leaks[0].evidence.length).toBeGreaterThan(0);
  });

  it('閾値は設定変更できる', () => {
    const dataset = buildSeedDataset(ASOF);
    const leaks = detectSalesLeaks(dataset, 'lcc', {
      inquiryHours: 72,
      estimateDays: 30,
      followUpDays: 30,
      stalledDays: 90
    });
    expect(leaks.map((leak) => leak.kind)).not.toContain('inquiry_unanswered');
    expect(leaks.map((leak) => leak.kind)).not.toContain('stalled');
  });
});
