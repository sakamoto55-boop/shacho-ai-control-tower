/**
 * Tool層。AIがDBを自由操作する設計にせず、明示的なToolだけを公開する。
 * Read ToolとWrite Toolを分離し、Write ToolはRisk Levelに応じて
 * 承認リクエスト（ApprovalRequest）を生成する。実行はPhase Aでは全てdry-run。
 */
import type {
  ActionRiskLevel,
  ApprovalRequest,
  CommandTask,
  CompanyScope,
  Evidence,
  ResearchTask
} from '../domain/types.js';
import { requiresApproval } from '../domain/approvalPolicy.js';
import type { CommandDataset } from '../data/seed.js';
import type { CommandRepository, CommandStore } from '../repositories/CommandRepository.js';
import { computeCashForecast } from '../engines/cashForecast.js';
import { checkInvoices } from '../engines/invoiceChecks.js';
import { computeProjectMargin } from '../engines/margin.js';
import { computeSalesSummary } from '../engines/sales.js';
import { detectSalesLeaks } from '../engines/salesLeak.js';
import { buildAlerts } from '../engines/alerts.js';
import { computeKpiSnapshot } from '../engines/kpi.js';

export interface ToolContext {
  dataset: CommandDataset;
  store: CommandStore;
  repository: CommandRepository;
  scope: CompanyScope;
}

export interface CommandToolDefinition {
  name: string;
  description: string;
  kind: 'read' | 'write';
  riskLevel: ActionRiskLevel;
  run(context: ToolContext, params?: Record<string, unknown>): Promise<unknown>;
}

let idSeq = 0;
function newId(prefix: string, asOf: string): string {
  return `${prefix}-${asOf.slice(0, 10)}-${idSeq++}`;
}

/** テストの再現性のためID連番をリセットする */
export function resetToolIdSeq(): void {
  idSeq = 0;
}

export const READ_TOOLS: CommandToolDefinition[] = [
  {
    name: 'get_company_summary',
    description: '経営KPIスナップショット（鮮度・確信度付き）',
    kind: 'read',
    riskLevel: 0,
    run: async (ctx) =>
      computeKpiSnapshot(
        ctx.dataset,
        ctx.scope,
        buildAlerts(ctx.dataset, ctx.scope, ctx.store.decisions)
      )
  },
  {
    name: 'get_cash_position',
    description: '現預金残高（口座別・鮮度付き）',
    kind: 'read',
    riskLevel: 0,
    run: async (ctx) => {
      const forecast = computeCashForecast(ctx.dataset, ctx.scope);
      return {
        currentBalance: forecast.currentBalance,
        freshness: forecast.freshness,
        evidence: forecast.evidence
      };
    }
  },
  {
    name: 'get_cash_forecast',
    description: '7/30/60/90日の資金繰り予測とシナリオ分析（決定論的計算）',
    kind: 'read',
    riskLevel: 0,
    run: async (ctx, params) =>
      computeCashForecast(ctx.dataset, ctx.scope, (params?.adjustments as never) ?? [])
  },
  {
    name: 'get_sales_summary',
    description: '当月売上・着地予測・目標比・受注残',
    kind: 'read',
    riskLevel: 0,
    run: async (ctx) => computeSalesSummary(ctx.dataset, ctx.scope)
  },
  {
    name: 'get_pipeline',
    description: '見積提出済みパイプライン（受注確度順）',
    kind: 'read',
    riskLevel: 0,
    run: async (ctx) => computeSalesSummary(ctx.dataset, ctx.scope).pipeline
  },
  {
    name: 'get_project_margin',
    description: '案件の予定・予測・実績粗利と悪化主因',
    kind: 'read',
    riskLevel: 0,
    run: async (ctx, params) => {
      const project = ctx.dataset.projects.find((item) => item.projectId === params?.projectId);
      return project ? computeProjectMargin(ctx.dataset, project) : null;
    }
  },
  {
    name: 'get_invoice_status',
    description: '完工未請求・期限超過・未入金・金額不一致の検出',
    kind: 'read',
    riskLevel: 0,
    run: async (ctx) => checkInvoices(ctx.dataset, ctx.scope)
  },
  {
    name: 'get_sales_leaks',
    description: '営業漏れ検知（優先順位付き）',
    kind: 'read',
    riskLevel: 0,
    run: async (ctx) => detectSalesLeaks(ctx.dataset, ctx.scope)
  },
  {
    name: 'get_alerts',
    description: 'アラート一覧（Decision Memoryによる抑制反映済み）',
    kind: 'read',
    riskLevel: 0,
    run: async (ctx) => buildAlerts(ctx.dataset, ctx.scope, ctx.store.decisions)
  },
  {
    name: 'get_interactions',
    description: '顧客・案件の営業接点履歴',
    kind: 'read',
    riskLevel: 0,
    run: async (ctx, params) =>
      ctx.dataset.interactions
        .filter((interaction) =>
          params?.customerId ? interaction.customerId === params.customerId : true
        )
        .sort((a, b) => b.datetime.localeCompare(a.datetime))
  }
];

export interface CreateTaskCandidateParams {
  companyId: string;
  title: string;
  projectId?: string;
  owner?: string;
  dueDate?: string;
  priority?: CommandTask['priority'];
  evidence?: Evidence[];
}

export async function createTaskCandidate(
  ctx: ToolContext,
  params: CreateTaskCandidateParams
): Promise<CommandTask> {
  // 会話・システム検知からタスク「候補」を作る。担当者へは勝手に指示せず、承認（確定）を待つ。
  const task: CommandTask = {
    taskId: newId('task', ctx.dataset.asOf),
    source: 'conversation',
    companyId: params.companyId,
    projectId: params.projectId,
    owner: params.owner,
    title: params.title,
    dueDate: params.dueDate,
    priority: params.priority ?? 'medium',
    status: 'candidate',
    evidence: params.evidence ?? [],
    createdAt: ctx.dataset.asOf
  };
  return ctx.repository.saveTask(task);
}

export interface RequestApprovalParams {
  companyId: string;
  riskLevel: ActionRiskLevel;
  action: string;
  target: string;
  amount?: number;
  before?: string;
  after?: string;
  aiReason: string;
  evidence?: Evidence[];
}

/**
 * Write Toolの共通経路。LEVEL 4以上（および設定によりLEVEL 3）は承認待ちで保存し、
 * 承認されるまで実行しない。実行自体もPhase Aは全てdry-run。
 */
export async function requestApproval(
  ctx: ToolContext,
  params: RequestApprovalParams
): Promise<ApprovalRequest> {
  if (!requiresApproval(params.riskLevel)) {
    throw new Error(
      `LEVEL ${params.riskLevel} の操作は承認リクエスト不要です（Tool設計を確認してください）`
    );
  }
  const approval: ApprovalRequest = {
    approvalId: newId('appr', ctx.dataset.asOf),
    companyId: params.companyId,
    riskLevel: params.riskLevel,
    action: params.action,
    target: params.target,
    amount: params.amount,
    before: params.before,
    after: params.after,
    aiReason: params.aiReason,
    evidence: params.evidence ?? [],
    status: 'waiting',
    createdAt: ctx.dataset.asOf
  };
  return ctx.repository.saveApproval(approval);
}

/** 外部Research Router。社内で答えられない質問を外部Providerへ非同期依頼する。 */
export async function requestResearch(
  ctx: ToolContext,
  params: { companyId: string; question: string; provider?: ResearchTask['provider'] }
): Promise<ResearchTask> {
  const task: ResearchTask = {
    researchId: newId('res', ctx.dataset.asOf),
    companyId: params.companyId,
    question: params.question,
    provider: params.provider ?? 'web_search',
    status: 'queued',
    requestedAt: ctx.dataset.asOf
  };
  return ctx.repository.saveResearch(task);
}
