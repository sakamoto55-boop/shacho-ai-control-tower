/**
 * 請求・入金チェックエンジン。「請求漏れ0」をシステムKPIとして扱うための検出器。
 * 完工未請求 / 請求期限超過 / 請求済未入金・入金予定超過 / 金額不一致 を決定論的に検出する。
 */
import type { AlertKind, CompanyScope, Evidence } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { filterDatasetByScope } from '../domain/scope.js';

export interface InvoiceIssue {
  kind: AlertKind;
  projectId?: string;
  invoiceId?: string;
  title: string;
  detail: string;
  amount: number;
  evidence: Evidence[];
}

export interface InvoiceCheckResult {
  scope: CompanyScope;
  issues: InvoiceIssue[];
  /** 完工未請求の合計額（KPI: 完工未請求額） */
  uninvoicedCompletedTotal: number;
  /** 請求済未入金（期日超過）の合計額 */
  overdueReceivableTotal: number;
}

export function checkInvoices(dataset: CommandDataset, scope: CompanyScope): InvoiceCheckResult {
  const scoped = filterDatasetByScope(dataset, scope);
  const today = dataset.asOf.slice(0, 10);
  const issues: InvoiceIssue[] = [];

  // 完工未請求: 完工済みで請求が1件も発行されていない案件
  let uninvoicedCompletedTotal = 0;
  for (const project of scoped.projects.filter((p) => p.stage === 'completed')) {
    const hasInvoice = scoped.invoices.some(
      (invoice) => invoice.projectId === project.projectId && invoice.issuedAt
    );
    if (!hasInvoice) {
      uninvoicedCompletedTotal += project.orderAmount;
      issues.push({
        kind: 'uninvoiced_completed',
        projectId: project.projectId,
        title: `完工未請求: ${project.name}`,
        detail: `${project.completedDate ?? '不明'}に完工していますが請求書が発行されていません（${project.orderAmount.toLocaleString()}円）。`,
        amount: project.orderAmount,
        evidence: [
          {
            label: '完工日',
            value: project.completedDate ?? '不明',
            refId: project.projectId,
            source: '案件台帳',
            asOf: project.updatedAt
          }
        ]
      });
    }
  }

  let overdueReceivableTotal = 0;
  for (const invoice of scoped.invoices) {
    const project = scoped.projects.find((p) => p.projectId === invoice.projectId);
    const customer = scoped.customers.find((c) => c.customerId === invoice.customerId);
    const evidence: Evidence[] = [
      {
        label: `請求書 ${invoice.invoiceId}`,
        value: `${invoice.amount.toLocaleString()}円（発行 ${invoice.issuedAt ?? '未発行'} / 期日 ${invoice.dueDate ?? '未設定'}）`,
        refId: invoice.invoiceId,
        source: '請求台帳',
        asOf: dataset.asOf
      }
    ];

    // 請求済未入金・入金予定超過
    if (
      invoice.status !== 'paid' &&
      !invoice.paidAt &&
      invoice.dueDate &&
      invoice.dueDate < today
    ) {
      overdueReceivableTotal += invoice.amount;
      const daysLate = Math.floor((Date.parse(today) - Date.parse(invoice.dueDate)) / 86_400_000);
      issues.push({
        kind: 'payment_overdue',
        projectId: invoice.projectId,
        invoiceId: invoice.invoiceId,
        title: `入金期日${daysLate}日超過: ${customer?.name ?? invoice.customerId}`,
        detail: `${project?.name ?? invoice.projectId}の請求${invoice.amount.toLocaleString()}円が期日${invoice.dueDate}を${daysLate}日超過しています。`,
        amount: invoice.amount,
        evidence
      });
    }

    // 金額不一致: 入金済みだが入金額合計が請求額と一致しない
    const received = scoped.payments
      .filter((payment) => payment.invoiceId === invoice.invoiceId && payment.direction === 'in')
      .reduce((sum, payment) => sum + payment.amount, 0);
    if (invoice.paidAt && received > 0 && received !== invoice.amount) {
      issues.push({
        kind: 'amount_mismatch',
        projectId: invoice.projectId,
        invoiceId: invoice.invoiceId,
        title: `金額不一致: ${customer?.name ?? invoice.customerId}`,
        detail: `請求${invoice.amount.toLocaleString()}円に対し入金${received.toLocaleString()}円。差額${(invoice.amount - received).toLocaleString()}円の確認が必要です。`,
        amount: invoice.amount - received,
        evidence: [
          ...evidence,
          {
            label: '入金合計',
            value: `${received.toLocaleString()}円`,
            refId: invoice.invoiceId,
            source: '入金記録',
            asOf: dataset.asOf
          }
        ]
      });
    }
  }

  return { scope, issues, uninvoicedCompletedTotal, overdueReceivableTotal };
}
