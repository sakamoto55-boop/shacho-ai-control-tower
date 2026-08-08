/**
 * データ品質検査。実データ接続時の不整合を検出する。
 * Phase B0では検出・報告のみで自動修正は行わない（元データを変更しない）。
 */
import type { CompanyScope } from './types.js';
import type { CommandDataset } from '../data/seed.js';
import { filterDatasetByScope } from './scope.js';

export type DataQualityKind =
  | 'customer_name_variant' // 顧客名表記ゆれ
  | 'project_missing_customer' // 顧客IDなし案件
  | 'project_duplicate' // 同一案件重複の疑い
  | 'completed_missing_date' // 完工日欠損
  | 'estimate_project_missing' // 見積の案件ID紐付け不能
  | 'estimate_amount_mismatch' // 見積額と受注額の不一致
  | 'invoice_project_missing' // 請求の案件紐付け不能
  | 'report_project_missing' // 日報と案件の紐付け不能
  | 'report_missing_employee' // 日報の社員ID欠損
  | 'assignment_project_missing'; // 配置と案件の紐付け不能

export interface DataQualityIssue {
  kind: DataQualityKind;
  severity: 'WARNING' | 'INFO';
  detail: string;
  refId?: string;
}

function normalizeName(name: string): string {
  return name
    .replace(/株式会社|有限会社|（株）|\(株\)|\s|\u3000/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

export function checkDataQuality(
  dataset: CommandDataset,
  scope: CompanyScope = 'group'
): DataQualityIssue[] {
  const scoped = filterDatasetByScope(dataset, scope);
  const issues: DataQualityIssue[] = [];

  // 顧客名表記ゆれ: 正規化後に同一なのにIDが異なる
  const byNormalized = new Map<string, string[]>();
  for (const customer of scoped.customers) {
    const key = normalizeName(customer.name);
    byNormalized.set(key, [
      ...(byNormalized.get(key) ?? []),
      `${customer.customerId}(${customer.name})`
    ]);
  }
  for (const [, ids] of byNormalized) {
    if (ids.length > 1) {
      issues.push({
        kind: 'customer_name_variant',
        severity: 'WARNING',
        detail: `同一と思われる顧客が複数IDで登録: ${ids.join(' / ')}`
      });
    }
  }

  const projectIds = new Set(scoped.projects.map((p) => p.projectId));
  const customerIds = new Set(scoped.customers.map((c) => c.customerId));
  const nameCount = new Map<string, number>();
  for (const project of scoped.projects) {
    if (!project.customerId || !customerIds.has(project.customerId)) {
      issues.push({
        kind: 'project_missing_customer',
        severity: 'WARNING',
        detail: `案件「${project.name}」に有効な顧客IDがありません`,
        refId: project.projectId
      });
    }
    if (['completed', 'invoiced', 'paid'].includes(project.stage) && !project.completedDate) {
      issues.push({
        kind: 'completed_missing_date',
        severity: 'WARNING',
        detail: `完工済み案件「${project.name}」に完工日がありません（月次売上集計に影響）`,
        refId: project.projectId
      });
    }
    const nameKey = normalizeName(project.name);
    nameCount.set(nameKey, (nameCount.get(nameKey) ?? 0) + 1);
  }
  for (const project of scoped.projects) {
    if ((nameCount.get(normalizeName(project.name)) ?? 0) > 1) {
      issues.push({
        kind: 'project_duplicate',
        severity: 'WARNING',
        detail: `同名案件が複数あります: 「${project.name}」`,
        refId: project.projectId
      });
    }
  }

  for (const estimate of scoped.estimates) {
    if (!projectIds.has(estimate.projectId)) {
      issues.push({
        kind: 'estimate_project_missing',
        severity: 'WARNING',
        detail: `見積${estimate.estimateId}の案件ID(${estimate.projectId})が案件台帳にありません`,
        refId: estimate.estimateId
      });
      continue;
    }
    const project = scoped.projects.find((p) => p.projectId === estimate.projectId);
    if (
      project &&
      estimate.status === 'ordered' &&
      project.orderAmount > 0 &&
      estimate.amount !== project.orderAmount
    ) {
      issues.push({
        kind: 'estimate_amount_mismatch',
        severity: 'INFO',
        detail: `「${project.name}」の受注見積額${estimate.amount.toLocaleString()}円と案件受注額${project.orderAmount.toLocaleString()}円が不一致`,
        refId: estimate.estimateId
      });
    }
  }

  for (const invoice of scoped.invoices) {
    if (!projectIds.has(invoice.projectId)) {
      issues.push({
        kind: 'invoice_project_missing',
        severity: 'WARNING',
        detail: `請求${invoice.invoiceId}の案件ID(${invoice.projectId})が案件台帳にありません`,
        refId: invoice.invoiceId
      });
    }
  }

  for (const report of scoped.dailyReports) {
    if (!report.projectId || !projectIds.has(report.projectId)) {
      issues.push({
        kind: 'report_project_missing',
        severity: 'WARNING',
        detail: `日報（${report.date} ${report.siteName} ${report.employeeName}）が案件に紐付いていません（原価集計に使えません）`,
        refId: report.reportId
      });
    }
    if (!report.employeeId) {
      issues.push({
        kind: 'report_missing_employee',
        severity: 'INFO',
        detail: `日報（${report.date} ${report.siteName}）の社員IDが未記入（氏名: ${report.employeeName}）`,
        refId: report.reportId
      });
    }
  }

  for (const assignment of scoped.assignments) {
    if (!assignment.projectId || !projectIds.has(assignment.projectId)) {
      issues.push({
        kind: 'assignment_project_missing',
        severity: 'INFO',
        detail: `配置（${assignment.date} ${assignment.siteName}）が案件に紐付いていません`,
        refId: assignment.assignmentId
      });
    }
  }

  return issues;
}
