/**
 * 法人スコープの適用。
 * 経営者は「グループ全体」「LCCだけ」「○○法人だけ」を切り替えられるが、
 * AIが勝手に法人間データを混在させないよう、データ絞り込みは必ずここを通す。
 */
import type { CompanyScope } from './types.js';
import type { CommandDataset } from '../data/seed.js';

export function inScope(companyId: string, scope: CompanyScope): boolean {
  return scope === 'group' || companyId === scope;
}

export function filterDatasetByScope(dataset: CommandDataset, scope: CompanyScope): CommandDataset {
  if (scope === 'group') return dataset;
  const byScope = <T extends { companyId: string }>(items: T[]) =>
    items.filter((item) => inScope(item.companyId, scope));
  return {
    ...dataset,
    companies: dataset.companies.filter((c) => c.companyId === scope),
    customers: byScope(dataset.customers),
    employees: byScope(dataset.employees),
    vendors: byScope(dataset.vendors),
    projects: byScope(dataset.projects),
    estimates: byScope(dataset.estimates),
    interactions: byScope(dataset.interactions),
    costs: byScope(dataset.costs),
    invoices: byScope(dataset.invoices),
    payments: byScope(dataset.payments),
    cashAccounts: byScope(dataset.cashAccounts),
    cashPlans: byScope(dataset.cashPlans),
    salesTargets: byScope(dataset.salesTargets)
  };
}

export function scopeLabel(dataset: CommandDataset, scope: CompanyScope): string {
  if (scope === 'group') return 'グループ全体';
  return dataset.companies.find((c) => c.companyId === scope)?.name ?? scope;
}
