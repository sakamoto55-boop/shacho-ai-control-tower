/**
 * Plan Executor（Phase N §4-§5, §12, §33, §36-§38）。
 *
 * - 依存のないTaskは並列実行（maxConcurrentTasksで制御）
 * - AgentはRoleごとの構造化Task結果を返す（自由議論なし）
 * - Privacy Boundary: 各Roleへは memoryAccess で許可された層の最小情報のみ渡す
 * - Reasoning Agentは不可逆操作をしない（EXECUTIONは承認経由・dry-run）
 * - Observability: Plan/Role/Provider/latency/成否/Fallback/根拠数を記録する
 */
import type { CompanyScope, Evidence, Principal } from '../domain/types.js';
import type { ToolContext } from '../tools/registry.js';
import { requestResearch } from '../tools/registry.js';
import { computeCashForecast, horizonBalance } from '../engines/cashForecast.js';
import { computeSalesSummary } from '../engines/sales.js';
import { findMarginDeteriorations } from '../engines/margin.js';
import { yen } from '../brief/generateBrief.js';
import {
  formatBacklogStatus,
  formatSalesLandingStatus,
  formatSalesMonthStatus
} from '../domain/semanticFormat.js';
import type { MemoryService } from '../memory/store.js';
import type { GeneralReasoner } from '../ai/generalReasoner.js';
import { ROLES, type RoleId } from './roles.js';
import { ProviderRegistry } from './providerRegistry.js';
import { devilsAdvocate, reviewAnswer, type CriticIssue } from './critic.js';
import type { PlannedTask, TaskPlan } from './rolePlanner.js';

export interface TaskResult {
  taskId: string;
  role: RoleId;
  providerId: string;
  facts: string[];
  options: string[];
  criticIssues: CriticIssue[];
  evidence: Evidence[];
  success: boolean;
  latencyMs: number;
}

export interface AgentTraceEntry {
  planId: string;
  taskId: string;
  role: RoleId;
  providerId: string;
  providerReason: string;
  latencyMs: number;
  toolCalls: number;
  success: boolean;
  fallbackUsed: boolean;
  evidenceCount: number;
  note?: string;
}

/** 「AIがなぜこの回答をしたか」を将来追跡するための記録 */
export class AgentTraceLog {
  private readonly entries: AgentTraceEntry[] = [];

  record(entry: AgentTraceEntry): void {
    this.entries.push(entry);
    if (this.entries.length > 500) this.entries.shift();
  }

  recent(limit = 50): AgentTraceEntry[] {
    return this.entries.slice(-limit);
  }

  forPlan(planId: string): AgentTraceEntry[] {
    return this.entries.filter((entry) => entry.planId === planId);
  }
}

export interface ExecutionOutcome {
  results: TaskResult[];
  synthesisText: string;
  evidence: Evidence[];
  criticIssues: CriticIssue[];
  planStatus: 'DONE' | 'PARTIAL';
}

export class PlanExecutor {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly memoryService: MemoryService,
    private readonly reasoner: GeneralReasoner,
    private readonly trace: AgentTraceLog
  ) {}

  async execute(
    plan: TaskPlan,
    ctx: ToolContext,
    principal: Principal,
    concise: boolean
  ): Promise<ExecutionOutcome> {
    const results = new Map<string, TaskResult>();
    const pending = [...plan.tasks];
    let steps = 0;

    while (pending.length > 0 && steps < plan.limits.maxSteps) {
      // 依存が解決済みのTaskを並列グループとして取り出す
      const ready = pending.filter((task) => task.dependsOn.every((dep) => results.has(dep)));
      if (ready.length === 0) break;
      const batch = ready.slice(0, plan.limits.maxConcurrentTasks);
      const batchResults = await Promise.all(
        batch.map((task) => this.runTask(plan, task, results, ctx, principal))
      );
      for (const result of batchResults) results.set(result.taskId, result);
      for (const task of batch) pending.splice(pending.indexOf(task), 1);
      steps += batch.length;
    }

    const ordered = plan.tasks
      .map((task) => results.get(task.taskId))
      .filter((r): r is TaskResult => Boolean(r));
    const criticIssues = ordered.flatMap((r) => r.criticIssues);
    const evidence = ordered.flatMap((r) => r.evidence).slice(0, 12);
    const synthesisText = this.synthesize(plan, ordered, criticIssues, concise);
    return {
      results: ordered,
      synthesisText,
      evidence,
      criticIssues,
      planStatus: ordered.length === plan.tasks.length ? 'DONE' : 'PARTIAL'
    };
  }

  private async runTask(
    plan: TaskPlan,
    task: PlannedTask,
    prior: Map<string, TaskResult>,
    ctx: ToolContext,
    principal: Principal
  ): Promise<TaskResult> {
    const role = ROLES[task.role];
    const startedAt = Date.now();
    const needsSensitive = role.handlesSensitive;
    const selection = this.registry.select(
      role.requiredCapabilities,
      role.preferredProviders,
      role.fallbackProviders,
      { needsSensitive }
    );
    const providerId = selection.provider?.providerId ?? 'deterministic';
    // Privacy Boundary: 依存Taskの結果のうち、このRoleのmemoryAccessで許可される要約のみ渡す
    const upstreamFacts =
      task.role === 'RESEARCH'
        ? [] // Privacy Boundary: RESEARCHへは社内要約を渡さない
        : task.dependsOn.flatMap((dep) => prior.get(dep)?.facts ?? []).slice(0, 10);

    let result: TaskResult;
    try {
      result = await this.runRole(plan, task, upstreamFacts, ctx, principal, providerId);
      this.registry.recordOutcome(providerId, true);
    } catch (error) {
      this.registry.recordOutcome(providerId, false);
      // Fallback（Data Policy違反の切替はselectが拒否する）
      const fallback = this.registry.select(role.requiredCapabilities, role.fallbackProviders, [], {
        needsSensitive,
        excludeIds: [providerId]
      });
      if (fallback.provider) {
        result = await this.runRole(
          plan,
          task,
          upstreamFacts,
          ctx,
          principal,
          fallback.provider.providerId
        );
        this.trace.record({
          planId: plan.planId,
          taskId: task.taskId,
          role: task.role,
          providerId: fallback.provider.providerId,
          providerReason: 'fallback',
          latencyMs: Date.now() - startedAt,
          toolCalls: 1,
          success: true,
          fallbackUsed: true,
          evidenceCount: result.evidence.length
        });
        return result;
      }
      result = {
        taskId: task.taskId,
        role: task.role,
        providerId,
        facts: [
          `${task.role}の処理に失敗しました: ${error instanceof Error ? error.message : String(error)}`
        ],
        options: [],
        criticIssues: [],
        evidence: [],
        success: false,
        latencyMs: Date.now() - startedAt
      };
    }
    this.trace.record({
      planId: plan.planId,
      taskId: task.taskId,
      role: task.role,
      providerId: result.providerId,
      providerReason: selection.reason,
      latencyMs: result.latencyMs,
      toolCalls: 1,
      success: result.success,
      fallbackUsed: false,
      evidenceCount: result.evidence.length,
      note: selection.policyBlock
    });
    return result;
  }

  private async runRole(
    plan: TaskPlan,
    task: PlannedTask,
    upstreamFacts: string[],
    ctx: ToolContext,
    principal: Principal,
    providerId: string
  ): Promise<TaskResult> {
    const startedAt = Date.now();
    const scope: CompanyScope = ctx.scope;
    const base = {
      taskId: task.taskId,
      role: task.role,
      providerId,
      options: [] as string[],
      criticIssues: [] as CriticIssue[],
      success: true
    };

    if (task.role === 'ANALYSIS') {
      const sales = computeSalesSummary(ctx.dataset, scope);
      const deteriorations = findMarginDeteriorations(ctx.dataset, scope);
      const facts = [
        `${formatSalesMonthStatus(sales)} / ${formatSalesLandingStatus(sales)}${sales.targetGapRate !== null ? `（目標比${(sales.targetGapRate * 100).toFixed(1)}%）` : ''}`,
        `${formatBacklogStatus(sales)} / 見積提出済パイプライン${sales.pipeline.length}件 ${yen(sales.pipelineTotal)}`,
        ...deteriorations
          .slice(0, 2)
          .map(
            (d) =>
              `粗利悪化: ${d.margin.projectName}（予定${((d.margin.plannedMarginRate ?? 0) * 100).toFixed(1)}%→予測${((d.margin.forecastMarginRate as number) * 100).toFixed(1)}%）`
          )
      ];
      return {
        ...base,
        facts,
        evidence: sales.evidence.slice(0, 4),
        latencyMs: Date.now() - startedAt
      };
    }
    if (task.role === 'FINANCE') {
      const cash = computeCashForecast(ctx.dataset, scope);
      const facts = cash.balanceKnown
        ? [
            `現預金${yen(cash.currentBalance)} / 30日後${yen(horizonBalance(cash, 30))} / 90日圏最低${yen(cash.minBalance.balance)}（${cash.minBalance.date}）`,
            cash.minBalance.balance > 5_000_000
              ? '短期の資金余力はあるが、大型投資は入金遅延シナリオでの再計算が必要'
              : '資金余力が薄く、新規投資は資金計画の再確認が必要'
          ]
        : ['銀行残高データ未接続のため資金面の実現性は判断できない'];
      return {
        ...base,
        facts,
        evidence: cash.evidence.slice(0, 4),
        latencyMs: Date.now() - startedAt
      };
    }
    if (task.role === 'MEMORY') {
      const memories = await this.memoryService.search({ q: plan.userGoal, limit: 5 }, principal);
      const facts =
        memories.length > 0
          ? memories.map((m) => `過去記憶[${m.type}] ${m.statement}（${m.validFrom}）`)
          : ['過去の類似判断・教訓は記憶にありません'];
      return {
        ...base,
        facts,
        evidence: memories.flatMap((m) => m.evidence).slice(0, 4),
        latencyMs: Date.now() - startedAt
      };
    }
    if (task.role === 'RESEARCH') {
      const companyId =
        scope === 'group' ? (ctx.dataset.companies[0]?.companyId ?? 'group') : scope;
      const research = await requestResearch(ctx, { companyId, question: plan.userGoal });
      return {
        ...base,
        facts: [
          `外部調査を依頼しました（状態: ${research.status}）。市場規模・競合・制度は結果到着後に社内事実と分離して提示します`
        ],
        evidence: [],
        latencyMs: Date.now() - startedAt
      };
    }
    if (task.role === 'STRATEGY') {
      if (this.reasoner.available) {
        const answer = await this.reasoner.answer(
          `${plan.userGoal}\nこの判断の選択肢と評価軸を3案で整理してください（決定はしない）。`,
          upstreamFacts
        );
        return {
          ...base,
          facts: [],
          options: [answer.text],
          evidence: [],
          latencyMs: Date.now() - startedAt
        };
      }
      return {
        ...base,
        facts: [],
        options: [
          '案A（実行）: 小規模テストから開始し、指標達成時のみ拡大する',
          '案B（保留）: 外部調査と資金シナリオの結果が揃うまで判断を保留する',
          '案C（代替）: 既存事業の低粗利改善へ同じリソースを投じる'
        ],
        evidence: [],
        latencyMs: Date.now() - startedAt
      };
    }
    if (task.role === 'CRITIC') {
      const draftText = [...upstreamFacts, ...task.dependsOn.map((d) => d)].join('\n');
      const decisions = await this.memoryService.search({ type: 'DECISION', limit: 5 }, principal);
      const review = reviewAnswer(
        { text: draftText, evidence: [], confidence: 'MEDIUM' },
        decisions,
        true
      );
      const counters = devilsAdvocate(plan.userGoal, upstreamFacts);
      return {
        ...base,
        facts: counters,
        criticIssues: review.issues,
        evidence: [],
        latencyMs: Date.now() - startedAt
      };
    }
    // STRUCTURING / SYNTHESIS / その他: 統合はsynthesizeで行うためパススルー
    return {
      ...base,
      facts: upstreamFacts.slice(0, 5),
      evidence: [],
      latencyMs: Date.now() - startedAt
    };
  }

  /** SYNTHESIS: 複数Role結果を羅列せず統合する（§12） */
  private synthesize(
    plan: TaskPlan,
    results: TaskResult[],
    criticIssues: CriticIssue[],
    concise: boolean
  ): string {
    const facts = results.filter((r) => r.role !== 'CRITIC').flatMap((r) => r.facts);
    const options = results.flatMap((r) => r.options);
    const counters = results.filter((r) => r.role === 'CRITIC').flatMap((r) => r.facts);
    const researchPending = results.some((r) => r.role === 'RESEARCH');

    const conclusion = researchPending
      ? '現時点では条件付きの判断が妥当です。外部調査の結果と資金シナリオを確認のうえ最終判断してください。'
      : '社内データと過去の判断に基づく条件付きの評価を示します。最終判断は経営者が行ってください。';

    if (concise) {
      return [
        `【結論】${conclusion}`,
        ...(facts.length > 0 ? [`【事実】${facts[0]}`] : []),
        ...(options.length > 0 ? [`【推奨】${options[0]}`] : []),
        '（詳細が必要なら「詳しく」と言ってください）'
      ].join('\n');
    }
    return [
      `【結論】`,
      conclusion,
      '',
      '【確認できた事実】',
      ...(facts.length > 0
        ? facts.map((f) => `・${f}`)
        : ['・この判断に直接使える社内データはまだ接続されていません']),
      '',
      '【分析】',
      '・上記の事実と過去の判断履歴に基づく評価です（AIの分析）。',
      '',
      '【リスク】',
      ...(criticIssues.length > 0
        ? criticIssues.slice(0, 3).map((i) => `・${i.issue}（対応: ${i.recommendation}）`)
        : ['・重大な検証指摘はありません']),
      ...(counters.length > 0
        ? ['', '【反対意見（Devil’s Advocate）】', ...counters.slice(0, 4).map((c) => `・${c}`)]
        : []),
      '',
      '【別案】',
      ...(options.length > 1
        ? options.slice(1).map((o) => `・${o}`)
        : ['・小さく実験して結果で判断する案']),
      '',
      '【推奨】',
      options[0]
        ? `・${options[0]}`
        : '・まず最小の実験を設計し、指標と撤退条件を決めてから着手する',
      '',
      '【次にやること】',
      '・実験として登録（指標・Baseline・Target・期限）すれば結果まで追跡します。',
      researchPending
        ? '・外部調査の完了を待って市場・競合の事実を確認します。'
        : '・不足データがあれば指定してください。'
    ].join('\n');
  }
}
