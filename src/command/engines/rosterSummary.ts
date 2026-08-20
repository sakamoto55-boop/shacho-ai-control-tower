/**
 * 案件・人員の決定論サマリ（純関数）。
 * - 金額はAIに暗算させず、確認済み(orderAmount!=null)のみ合計＋カバレッジ併記（0円へ変換しない）。
 * - 法人スコープは必ず filterDatasetByScope を通す（法人間データを混在させない）。
 * - status(stage)は'unknown'を勝手に既定ステージへ変換しない（意味監査未了はそのまま「状態未確認」）。
 */
import type { CommandDataset } from '../data/seed.js';
import type { CompanyScope } from '../domain/types.js';
import { filterDatasetByScope } from '../domain/scope.js';

const STAGE_LABELS: Record<string, string> = {
  inquiry: '問い合わせ',
  survey: '現地調査',
  estimating: '見積中',
  following: '追客',
  ordered: '受注',
  in_progress: '施工中',
  completed: '完工',
  invoiced: '請求済',
  paid: '入金済',
  lost: '失注',
  unknown: '状態未確認'
};

/** 案件ステージの表示順（未確認は末尾） */
const STAGE_ORDER = [
  'inquiry',
  'survey',
  'estimating',
  'following',
  'ordered',
  'in_progress',
  'completed',
  'invoiced',
  'paid',
  'lost',
  'unknown'
];

export interface StageCount {
  stage: string;
  label: string;
  count: number;
}

export interface ProjectsSummary {
  scope: CompanyScope;
  total: number;
  byStage: StageCount[];
  /** 進行中（受注〜施工中）の件数 */
  activeCount: number;
  /** 金額確認済の件数と契約額合計（未確認は含めない） */
  amount: { confirmedCount: number; total: number; coveragePct: number; confirmedSum: number };
}

export function summarizeProjects(dataset: CommandDataset, scope: CompanyScope): ProjectsSummary {
  const scoped = filterDatasetByScope(dataset, scope);
  const projects = scoped.projects;
  const counts = new Map<string, number>();
  let confirmedCount = 0;
  let confirmedSum = 0;
  for (const p of projects) {
    const stage = p.stage ?? 'unknown';
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
    if (p.orderAmount !== null && p.orderAmount !== undefined) {
      confirmedCount += 1;
      confirmedSum += p.orderAmount;
    }
  }
  const byStage: StageCount[] = STAGE_ORDER.filter((s) => counts.has(s)).map((s) => ({
    stage: s,
    label: STAGE_LABELS[s] ?? s,
    count: counts.get(s) ?? 0
  }));
  const activeCount = ['ordered', 'in_progress'].reduce((n, s) => n + (counts.get(s) ?? 0), 0);
  const total = projects.length;
  return {
    scope,
    total,
    byStage,
    activeCount,
    amount: {
      confirmedCount,
      total,
      coveragePct: total ? Math.round((confirmedCount / total) * 100) : 0,
      confirmedSum
    }
  };
}

export interface RoleCount {
  role: string;
  count: number;
}

export interface PersonnelSummary {
  scope: CompanyScope;
  employees: number;
  byRole: RoleCount[];
  vendors: number;
  /** 予定配置（配置板）。実績ではない */
  scheduledAssignments: number;
  /** 実績日報（人工の根拠） */
  dailyReports: number;
}

export function summarizePersonnel(dataset: CommandDataset, scope: CompanyScope): PersonnelSummary {
  const scoped = filterDatasetByScope(dataset, scope);
  const roleCounts = new Map<string, number>();
  for (const e of scoped.employees) {
    const role = (e.role ?? '').trim() || '（役割未設定）';
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  const byRole: RoleCount[] = [...roleCounts.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count);
  return {
    scope,
    employees: scoped.employees.length,
    byRole,
    vendors: scoped.vendors.length,
    scheduledAssignments: scoped.assignments.length,
    dailyReports: scoped.dailyReports.length
  };
}
