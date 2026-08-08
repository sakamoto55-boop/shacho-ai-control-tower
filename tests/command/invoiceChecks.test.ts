import { describe, expect, it } from 'vitest';
import { buildSeedDataset } from '../../src/command/data/seed.js';
import { checkInvoices } from '../../src/command/engines/invoiceChecks.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('請求・入金チェックエンジン', () => {
  it('完工未請求・期日超過未入金・金額不一致を検出する', () => {
    const dataset = buildSeedDataset(ASOF);
    const result = checkInvoices(dataset, 'lcc');
    const kinds = result.issues.map((issue) => issue.kind);

    expect(kinds).toContain('uninvoiced_completed');
    expect(kinds).toContain('payment_overdue');
    expect(kinds).toContain('amount_mismatch');
    expect(result.uninvoicedCompletedTotal).toBe(6_000_000);
    expect(result.overdueReceivableTotal).toBe(3_300_000);
  });

  it('金額不一致は差額を計算する', () => {
    const dataset = buildSeedDataset(ASOF);
    const mismatch = checkInvoices(dataset, 'lcc').issues.find(
      (issue) => issue.kind === 'amount_mismatch'
    )!;
    expect(mismatch.amount).toBe(200_000);
    expect(mismatch.detail).toContain('2,200,000');
    expect(mismatch.detail).toContain('2,000,000');
  });

  it('入金済み・期日内の請求は問題として扱わない', () => {
    const dataset = buildSeedDataset(ASOF);
    const result = checkInvoices(dataset, 'lcc');
    expect(result.issues.some((issue) => issue.invoiceId === 'inv-d')).toBe(false);
    expect(result.issues.some((issue) => issue.invoiceId === 'inv-e')).toBe(false);
  });
});
