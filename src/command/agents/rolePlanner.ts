/**
 * Role Router / Task Plan（Phase N §3-§5, §34-§35）。
 *
 * Universal Conversation Routerの上位で入力を多面的に評価し、
 * 必要な場合のみ複数RoleのExecution Planを作る。
 * 通常会話は単独処理（Cost Guardrail）。「徹底的に」等でDEEPへ昇格する。
 * LLM同士の無制限会話は禁止 — Planは構造化Taskの有向グラフのみ。
 */
import {
  classifyConversation,
  type ConversationCategory
} from '../orchestrator/universalRouter.js';
import type { RoleId } from './roles.js';

export type ExecutionBudget = 'LOW' | 'NORMAL' | 'DEEP';

export interface BudgetLimits {
  maxAgents: number;
  maxSteps: number;
  maxTokens: number;
  maxResearchTasks: number;
  maxConcurrentTasks: number;
}

export const BUDGET_LIMITS: Record<ExecutionBudget, BudgetLimits> = {
  LOW: { maxAgents: 1, maxSteps: 4, maxTokens: 2_000, maxResearchTasks: 0, maxConcurrentTasks: 1 },
  NORMAL: {
    maxAgents: 4,
    maxSteps: 10,
    maxTokens: 8_000,
    maxResearchTasks: 1,
    maxConcurrentTasks: 2
  },
  DEEP: {
    maxAgents: 8,
    maxSteps: 20,
    maxTokens: 30_000,
    maxResearchTasks: 3,
    maxConcurrentTasks: 3
  }
};

export interface InputAssessment {
  categories: ConversationCategory[];
  complexity: 'LOW' | 'MEDIUM' | 'HIGH';
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  internalDataNeed: boolean;
  externalDataNeed: boolean;
  reasoningDepth: 'SHALLOW' | 'MEDIUM' | 'DEEP';
  executionNeed: boolean;
  freshnessNeed: boolean;
  confidentiality: 'NORMAL' | 'SENSITIVE';
  urgency: 'NORMAL' | 'URGENT';
  budget: ExecutionBudget;
}

export function assessInput(message: string): InputAssessment {
  const categories = classifyConversation(message);
  const deepRequested = /徹底的|超絶|深く考えて|漏れなく|全体的に|洗いざらい/.test(message);
  const strategic = /やるべきか|新規事業|参入|撤退|投資|買収|戦略/.test(message);
  const highRisk = strategic || /契約|解雇|採用|給与|借入|(\d{3,}|数千)万円|億円/.test(message);
  const externalDataNeed = /競合|市場|制度|法律|法令|他社|他業界|業界動向|調べて/.test(message);
  const internalDataNeed =
    /売上|現金|資金|案件|請求|粗利|原価|見積|現場|配置|日報|過去|前に/.test(message) ||
    categories.includes('FACT_LOOKUP') ||
    categories.includes('MEMORY_RECALL');
  const multiConcern = categories.length >= 3 || (strategic && externalDataNeed);
  const complexity = multiConcern ? 'HIGH' : categories.length === 2 ? 'MEDIUM' : 'LOW';
  return {
    categories,
    complexity,
    risk: highRisk ? 'HIGH' : complexity === 'HIGH' ? 'MEDIUM' : 'LOW',
    internalDataNeed,
    externalDataNeed,
    reasoningDepth:
      deepRequested || strategic ? 'DEEP' : complexity === 'LOW' ? 'SHALLOW' : 'MEDIUM',
    executionNeed: categories.includes('ACTION_REQUEST'),
    freshnessNeed: /今日|今|現在|最新/.test(message),
    confidentiality: /給与|人事|評価|口座/.test(message) ? 'SENSITIVE' : 'NORMAL',
    urgency: /至急|今すぐ|急ぎ/.test(message) ? 'URGENT' : 'NORMAL',
    budget: deepRequested ? 'DEEP' : multiConcern ? 'NORMAL' : 'LOW'
  };
}

export type TaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';

export interface PlannedTask {
  taskId: string;
  role: RoleId;
  objective: string;
  inputRefs: string[];
  toolNeeds: string[];
  memoryNeeds: string[];
  outputSchema: 'facts' | 'analysis' | 'options' | 'critique' | 'synthesis' | 'research_request';
  status: TaskStatus;
  /** 依存TaskId。空なら並列実行可能 */
  dependsOn: string[];
}

export interface TaskPlan {
  planId: string;
  userGoal: string;
  tasks: PlannedTask[];
  parallelizable: boolean;
  risk: InputAssessment['risk'];
  status: 'PLANNED' | 'RUNNING' | 'DONE' | 'PARTIAL';
  evidenceRequirements: 'REQUIRED' | 'OPTIONAL';
  stopConditions: string[];
  budget: ExecutionBudget;
  limits: BudgetLimits;
}

let planSeq = 0;
export function resetPlanSeq(): void {
  planSeq = 0;
}

/**
 * 複数Roleが必要な質問（戦略×調査×財務など）のPlanを作る。
 * 単一Roleで足りる質問はnullを返し、既存の単独処理へ委ねる（過剰なPlanを作らない）。
 */
export function buildPlan(message: string, assessment: InputAssessment): TaskPlan | null {
  // 過剰なPlanを作らない: 外部調査を要するか、戦略級/明示的DEEP要求の場合のみ複数Role化する
  const needsMultiRole =
    assessment.budget !== 'LOW' &&
    (assessment.externalDataNeed || assessment.reasoningDepth === 'DEEP');
  if (!needsMultiRole) return null;

  const limits = BUDGET_LIMITS[assessment.budget];
  const tasks: PlannedTask[] = [];
  const task = (
    role: RoleId,
    objective: string,
    outputSchema: PlannedTask['outputSchema'],
    dependsOn: string[] = []
  ): string => {
    const taskId = `t${tasks.length + 1}`;
    tasks.push({
      taskId,
      role,
      objective,
      inputRefs: dependsOn,
      toolNeeds: [],
      memoryNeeds: role === 'MEMORY' ? ['COMPANY', 'PRESIDENT'] : [],
      outputSchema,
      status: 'PENDING',
      dependsOn
    });
    return taskId;
  };

  // 並列フェーズ: 社内事実・過去記憶・（許可されれば）外部調査
  const parallel: string[] = [];
  if (assessment.internalDataNeed) {
    parallel.push(
      task('ANALYSIS', '関連する社内データ（売上・案件・資金・粗利）を確認する', 'facts')
    );
  }
  parallel.push(task('MEMORY', '過去の類似判断・教訓・関連Decisionを検索する', 'facts'));
  if (assessment.externalDataNeed && limits.maxResearchTasks > 0) {
    parallel.push(
      task('RESEARCH', '市場・競合・制度の外部調査を依頼する（社内事実と分離）', 'research_request')
    );
  }

  // 統合フェーズ
  const strategyId = task(
    'STRATEGY',
    '選択肢と評価軸を整理する（決定はしない）',
    'options',
    parallel
  );
  const financeId = assessment.internalDataNeed
    ? task('FINANCE', '資金・収益面の実現性を決定論的に確認する', 'analysis', parallel)
    : null;
  const criticDeps = financeId ? [strategyId, financeId] : [strategyId];
  const criticId =
    assessment.risk === 'HIGH'
      ? task('CRITIC', '根拠・矛盾・リスク過小評価・反対意見を検証する', 'critique', criticDeps)
      : null;
  task(
    'SYNTHESIS',
    '結論→事実→分析→リスク→別案→推奨→次アクションへ統合する',
    'synthesis',
    criticId ? [criticId] : criticDeps
  );

  // Guardrail: maxAgentsを超えるPlanは作らない（末尾から削って縮退）
  while (tasks.length > limits.maxAgents + 1) tasks.splice(tasks.length - 2, 1);

  return {
    planId: `plan-${planSeq++}`,
    userGoal: message,
    tasks,
    parallelizable: parallel.length > 1,
    risk: assessment.risk,
    status: 'PLANNED',
    evidenceRequirements: 'REQUIRED',
    stopConditions: [`maxSteps=${limits.maxSteps}`, `maxAgents=${limits.maxAgents}`, 'timeout'],
    budget: assessment.budget,
    limits
  };
}
