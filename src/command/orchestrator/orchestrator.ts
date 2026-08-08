/**
 * Orchestrator。会話をシステムの中心に置くための中核。
 *
 * 構造は Planner（意図分解）→ Tool Selection（決定論エンジン実行）→ Response Synthesis に分離し、
 * 常時マルチエージェントを乱立させない。無制限のAgent Loopは禁止で、
 * ORCHESTRATOR_LIMITS（maxSteps / maxToolCalls / timeoutMs）を強制する。
 *
 * 回答の優先順位: LEVEL1 確定データ → LEVEL2 計算結果 → LEVEL3 確認済み社内文書
 * → LEVEL4 経営判断履歴 → LEVEL5 外部一次情報 → LEVEL6 AI分析・仮説。
 * データがない場合は推測で埋めず「分からない」を正しく返す。
 * セキュリティ: Principalのスコープ検査をTool実行前に必ず行い、
 * ユーザー入力・外部文書内の命令はSystem Instructionとして扱わない。
 */
import type {
  CashScenarioAdjustment,
  CommandChatRequest,
  CommandChatResponse,
  CompanyScope,
  Customer,
  DataStatus,
  Principal,
  Project
} from '../domain/types.js';
import { filterDatasetByScope, scopeLabel } from '../domain/scope.js';
import type { CommandDataset } from '../data/seed.js';
import type { CommandRepository } from '../repositories/CommandRepository.js';
import { datasetAvailability } from '../sources/SourceAdapter.js';
import { assertScopeAllowed, canRequestWrite } from '../domain/rbac.js';
import { detectInjection } from '../security/security.js';
import { computeCashForecast, diffCashForecast, horizonBalance } from '../engines/cashForecast.js';
import { checkInvoices } from '../engines/invoiceChecks.js';
import { computeProjectMargin, findMarginDeteriorations } from '../engines/margin.js';
import { computeNextMonthOutlook, computeSalesSummary } from '../engines/sales.js';
import { detectSalesLeaks } from '../engines/salesLeak.js';
import { buildAlerts, activeAlerts } from '../engines/alerts.js';
import { generateExecutiveBrief, yen } from '../brief/generateBrief.js';
import {
  createTaskCandidate,
  requestApproval,
  requestResearch,
  type ToolContext
} from '../tools/registry.js';
import { addDaysJst, jstDate } from '../utils/jst.js';
import { ContextStore, type ConversationContext, type IntentKey } from './context.js';
import { MemoryService } from '../memory/store.js';
import {
  curateConversationTurn,
  detectCorrection,
  extractEntities,
  type LlmCandidateExtractor
} from '../memory/curator.js';
import { discoverProblems, rankInsights } from '../memory/maintenance.js';
import type { ObservabilityLog } from '../observability/observability.js';
import { classifyConversation } from './universalRouter.js';
import { buildInnovationProposal, formatInnovationProposal } from '../memory/innovation.js';
import { GeneralReasoner, createGeneralRouter } from '../ai/generalReasoner.js';
import { assessInput, buildPlan } from '../agents/rolePlanner.js';
import { AgentTraceLog, PlanExecutor } from '../agents/executor.js';
import { createDefaultRegistry } from '../agents/providerRegistry.js';
import {
  devilsAdvocate,
  reviewAnswerWithAdvisor,
  type LlmCriticAdvisor
} from '../agents/critic.js';
import { analyzeCorrectionImpact, formatImpactReport } from '../agents/correctionImpact.js';

/** 無制限ループ禁止のための上限。1リクエストで超えたら打ち切る */
export const ORCHESTRATOR_LIMITS = {
  maxSteps: 6,
  maxToolCalls: 10,
  timeoutMs: 5000
};

const DEFAULT_PRINCIPAL: Principal = { role: 'PRESIDENT', companyIds: [], label: 'demo-president' };

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function findProject(dataset: CommandDataset, message: string): Project | undefined {
  return dataset.projects.find((project) => {
    const shortName = project.name.split('（')[0];
    return (
      message.includes(shortName) ||
      (shortName.length >= 3 && message.includes(shortName.slice(0, 3)))
    );
  });
}

function findCustomer(dataset: CommandDataset, message: string): Customer | undefined {
  return dataset.customers.find((customer) => {
    const base = customer.name.replace(/株式会社|（.*?）/g, '');
    return message.includes(base) || (base.length >= 2 && message.includes(base.slice(0, 2)));
  });
}

/** 「2番目」「２番目」「三番目」等の序数を解決する */
function parseOrdinal(message: string): number | null {
  const normalized = message.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
  const arabic = normalized.match(/(\d+)\s*(番目|つ目|番)/);
  if (arabic) return Number(arabic[1]);
  const kanji: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };
  // 「一番危ない」等の最上級表現と衝突しないよう、漢数字は「番目/つ目」のみ序数とみなす
  const kanjiMatch = normalized.match(/([一二三四五])(番目|つ目)/);
  if (kanjiMatch) return kanji[kanjiMatch[1]];
  return null;
}

interface HandlerResult {
  response: CommandChatResponse;
  intent: IntentKey;
  projectId?: string | null;
  customerId?: string | null;
  listItems?: ConversationContext['lastListItems'];
  listShown?: number;
  draft?: ConversationContext['lastDraft'];
  memoryIds?: string[];
  proposal?: { problem: string } | null;
}

interface ExecutionState {
  toolCalls: number;
  steps: number;
  startedAtMs: number;
}

/** Phase B1: LLMフック・Observabilityの注入点（未指定時は従来どおり決定論のみで動作） */
export interface OrchestratorOptions {
  /** LLM Curator v2: 候補提案のみ。保存可否はLearning Safetyが最終判定 */
  curatorExtractor?: LlmCandidateExtractor;
  /** Critic v2: 指摘の追加のみ。決定論検査が最終判定 */
  criticAdvisor?: LlmCriticAdvisor;
  /** 会話メタデータ・フィードバックの記録先 */
  observability?: ObservabilityLog;
}

export class CommandOrchestrator {
  private readonly contexts = new ContextStore();
  private readonly memoryService: MemoryService;
  private readonly reasoner: GeneralReasoner;

  private readonly traceLog = new AgentTraceLog();
  private readonly executor: PlanExecutor;

  constructor(
    private readonly repository: CommandRepository,
    private readonly options: OrchestratorOptions = {}
  ) {
    this.memoryService = new MemoryService(repository);
    this.reasoner = new GeneralReasoner(createGeneralRouter());
    this.executor = new PlanExecutor(
      createDefaultRegistry(),
      this.memoryService,
      this.reasoner,
      this.traceLog
    );
  }

  /** Agent Observability: なぜこの回答になったかを追跡する記録 */
  getAgentTraces(limit = 50) {
    return this.traceLog.recent(limit);
  }

  async chat(
    request: CommandChatRequest,
    principal: Principal = DEFAULT_PRINCIPAL
  ): Promise<CommandChatResponse> {
    const asOf = request.asOf ?? new Date().toISOString();
    const sessionId = request.sessionId ?? 'default';
    const context = this.contexts.get(sessionId, request.scope ?? 'group');
    const scope: CompanyScope = request.scope ?? context.scope ?? 'group';

    // RBAC: Tool実行前にスコープを強制（UI側の制御には依存しない）
    assertScopeAllowed(principal, scope);

    const dataset = await this.repository.getDataset(asOf);
    const store = await this.repository.getStore();
    const ctx: ToolContext = { dataset, store, repository: this.repository, scope };
    const message = request.message.trim();
    const dataStatus = datasetAvailability(dataset);
    const state: ExecutionState = { toolCalls: 0, steps: 0, startedAtMs: Date.now() };

    // Demo Fixture隔離: productionで実データが無い場合、数値回答を一切行わない
    if (dataStatus === 'DATA_UNAVAILABLE') {
      const sourceLines = dataset.meta.sources
        .slice(0, 6)
        .map((s) => `・${s.sourceName}: ${s.errorState ?? '状態不明'}`);
      const response: CommandChatResponse = {
        text: [
          '【DATA UNAVAILABLE / CONNECTION ERROR】',
          '実データソースに接続できないため、経営数値の回答はできません。',
          'デモ数値の表示は本番モードでは行いません。',
          '',
          'ソース状態:',
          ...sourceLines
        ].join('\n'),
        dataStatus: 'DATA_UNAVAILABLE',
        uiHint: 'text',
        confidence: 'UNKNOWN',
        evidence: [],
        toolsUsed: []
      };
      this.remember(context, scope, { response, intent: 'unknown' });
      return response;
    }

    // Prompt Injection: 命令上書き・全データ開示等のパターンは指示として扱わない
    if (detectInjection(message)) {
      const response: CommandChatResponse = {
        text: [
          '入力に、システム指示の上書きや一括開示を求めるパターンが含まれていたため、指示としては実行しませんでした。',
          '経営データに関する具体的な質問（例: 今月どう？ / 現金大丈夫？）として言い換えてください。'
        ].join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence: 'UNKNOWN',
        evidence: [],
        toolsUsed: []
      };
      this.remember(context, scope, { response, intent: 'unknown' });
      return response;
    }

    const result = await this.dispatch(ctx, message, context, principal, state, dataStatus);

    // Memory Curator: 会話から意味単位の記憶候補を抽出（Learning Safetyはstore側で強制）
    if (result.intent !== 'memory_recall') {
      try {
        const companyId = scope === 'group' ? (dataset.companies[0]?.companyId ?? 'group') : scope;
        const curation = await curateConversationTurn(
          this.memoryService,
          dataset,
          message,
          principal,
          companyId,
          asOf,
          sessionId,
          this.options.curatorExtractor
        );
        if (curation.notices.length > 0) {
          result.response.text += `\n\n${curation.notices.join('\n')}`;
        }
        if (curation.saved.length > 0 && !result.memoryIds) {
          result.memoryIds = curation.saved.map((item) => item.record.memoryId);
        }
      } catch {
        // 記憶抽出の失敗で会話を止めない
      }
    }

    this.remember(context, scope, result);

    // Observability: 会話本文は保存せず、メタデータのみ記録（§19）
    void this.options.observability?.record({
      kind: 'chat',
      sessionId,
      scope,
      actor: principal.label,
      intent: result.intent,
      toolsUsed: result.response.toolsUsed,
      confidence: result.response.confidence,
      dataStatus,
      durationMs: Date.now() - state.startedAtMs
    });

    return result.response;
  }

  // ------------------------------------------------------------------
  // Planner / dispatch
  // ------------------------------------------------------------------

  private async dispatch(
    ctx: ToolContext,
    message: string,
    context: ConversationContext,
    principal: Principal,
    state: ExecutionState,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    // --- 複合質問: 複数ドメインにまたがる場合はPlannerで分解し統合する（文脈解決より優先） ---
    const compound = await this.tryCompound(ctx, message, state, dataStatus);
    if (compound) return compound;

    // --- 文脈フォローアップ（直前の話題を参照する発話） ---
    const followUp = await this.tryFollowUp(ctx, message, context, principal, state, dataStatus);
    if (followUp) return followUp;

    // --- Multi-Agent Plan（戦略×調査×財務など。通常会話は単独処理 = Cost Guardrail） ---
    const assessment = assessInput(message);
    const plan = buildPlan(message, assessment);
    if (plan) return this.handlePlan(ctx, message, plan, principal, dataStatus);

    // --- Phase N 会話（記憶操作・検証・影響） ---
    if (/覚えておいて|覚えといて/.test(message)) {
      return this.handleRememberThis(ctx, message, context, principal, dataStatus);
    }
    if (/今の(は)?なし|取り消し|やっぱりなし/.test(message) && context.lastMemoryIds.length > 0) {
      return this.handleUndoMemory(ctx, context, dataStatus);
    }
    if (/正式(方針|決定)に(する|して)/.test(message) && context.lastMemoryIds.length > 0) {
      return this.handlePromoteDecision(ctx, context, principal, dataStatus);
    }
    if (/影響(する|ある)(ところ|の)|どこに影響/.test(message) && context.lastMemoryIds.length > 0) {
      return this.handleImpactQuery(ctx, context, dataStatus);
    }
    if (/もっと大胆/.test(message)) {
      return this.handleInnovation(
        ctx,
        context.lastProposal?.problem ?? message,
        principal,
        dataStatus,
        { bold: true }
      );
    }
    if (/その案.{0,6}リスク|案のリスク/.test(message) && context.lastProposal) {
      return this.handleProposalRisk(ctx, context, dataStatus);
    }
    if (/別の見方|反対意見|間違いない/.test(message)) {
      return this.handleDevilsAdvocate(ctx, context, principal, dataStatus);
    }
    if (/結果どうだった|実験.{0,4}結果/.test(message)) {
      return this.handleExperimentStatus(ctx, dataStatus);
    }

    // --- Persistent Memory（訂正・想起・監査・判断レビュー） ---
    if (detectCorrection(message).isCorrection && context.lastMemoryIds.length > 0) {
      return this.handleCorrection(ctx, message, context, principal, dataStatus);
    }
    if (/今日.{0,4}(何を|なに)?(覚えた|学んだ)/.test(message)) {
      return this.handleLearnedToday(ctx, principal, dataStatus);
    }
    if (/(私|会社)について何を覚えて|何を記憶して/.test(message)) {
      return this.handleMemoryAudit(ctx, principal, dataStatus);
    }
    if (/今も正しい|まだ有効/.test(message) && context.lastMemoryIds.length > 0) {
      return this.handleDecisionReview(ctx, context, dataStatus);
    }
    if (
      /(^|[、。\s])(前に|以前)|^前に|昨日の話|この間|何だっけ|言ってた|覚えてる|覚えている/.test(
        message
      )
    ) {
      return this.handleMemoryRecall(ctx, message, context, principal, dataStatus);
    }
    if (
      /(アイデア|新しい事業|工夫|いいやり方|改善案|対策).{0,8}(考えて|ない？|ある？|出して)|考えて$/.test(
        message
      )
    ) {
      return this.handleInnovation(ctx, message, principal, dataStatus, {
        firstPrinciples: /そもそも|根本から|ゼロから/.test(message)
      });
    }

    // --- Write系（下書き→承認） ---
    if (/送って|送信して/.test(message))
      return this.handleSendRequest(ctx, message, context, principal, dataStatus);
    if (/連絡文|連絡案|文面.{0,4}(作|お願い)|どう(連絡|返)/.test(message)) {
      return this.handleDraft(ctx, message, context, principal, dataStatus);
    }
    if (
      (/(調べて|調査して|使える？|使えますか)/.test(message) &&
        /(会社|制度|法律|法令|補助金|競合|市場|業界|相場|自治体)/.test(message)) ||
      /調べて$/.test(message)
    ) {
      return this.handleResearch(ctx, message, principal, dataStatus);
    }
    if (/どう思う|この判断/.test(message))
      return this.handleAdvice(ctx, message, context, dataStatus);

    // --- Read系 ---
    if (/おはよう|ブリーフ|朝の報告|今日の報告/i.test(message))
      return this.runIntent('brief', ctx, dataStatus);
    if (/今日の現場|今日.{0,4}(どこ|配置)/.test(message))
      return this.handleTodaySites(ctx, dataStatus);
    if (/昨日.{0,6}(誰|どこ|行った)/.test(message))
      return this.handleYesterdayReports(ctx, dataStatus);
    if (/遅れたら|買ったら|購入したら|使ったら/.test(message))
      return this.handleCashScenario(ctx, message, dataStatus);
    if (/最終接点|最後の(連絡|接点)|いつ(連絡|会っ)/.test(message))
      return this.handleLastContact(ctx, message, dataStatus);
    if (/請求.{0,4}(漏|も)れ|未請求|未入金|入金.{0,4}(遅|超過)/.test(message))
      return this.runIntent('invoices', ctx, dataStatus);
    if (/危ない|やばい|まずい|リスク.{0,4}(案件|現場)|悪い現場/.test(message))
      return this.runIntent('risky', ctx, dataStatus);
    if (/今日.{0,6}(やる|すべき|何)|やること|要対応/.test(message))
      return this.runIntent('today', ctx, dataStatus);
    if (/来月|仕事.{0,4}足り|パイプライン|見込み案件/.test(message))
      return this.runIntent('pipeline', ctx, dataStatus);
    if (/現金|資金|キャッシュ|銀行残高/.test(message))
      return this.runIntent('cash', ctx, dataStatus);

    const project = findProject(ctx.dataset, message);
    if (project && /なぜ|why|利益|粗利|原価/.test(message))
      return this.handleMarginWhy(ctx, project, dataStatus);
    if (project) return this.handleProjectCard(ctx, project, dataStatus);

    const employee = filterDatasetByScope(ctx.dataset, ctx.scope).employees.find((item) =>
      message.includes(item.name)
    );
    if (employee)
      return this.handleEmployeeProjects(ctx, employee.employeeId, employee.name, dataStatus);

    if (/売上|今月どう|着地|目標/.test(message)) return this.runIntent('sales', ctx, dataStatus);

    // 固定Intent外はUNKNOWNで終了せず、General Reasoningへフォールバックする
    return this.handleGeneral(ctx, message, principal, dataStatus);
  }

  /** Intentキーからの再実行（スコープ切替・文脈再訪で使う） */
  private async runIntent(
    intent: IntentKey,
    ctx: ToolContext,
    dataStatus: DataStatus,
    projectId?: string | null
  ): Promise<HandlerResult> {
    const project = projectId
      ? ctx.dataset.projects.find((p) => p.projectId === projectId)
      : undefined;
    switch (intent) {
      case 'brief':
        return this.handleBrief(ctx, dataStatus);
      case 'sales':
        return this.handleSales(ctx, dataStatus);
      case 'cash':
        return this.handleCash(ctx, dataStatus);
      case 'risky':
        return this.handleRiskyProjects(ctx, dataStatus);
      case 'invoices':
        return this.handleInvoices(ctx, dataStatus);
      case 'today':
        return this.handleToday(ctx, dataStatus);
      case 'pipeline':
        return this.handlePipeline(ctx, dataStatus);
      case 'margin_why':
        if (project) return this.handleMarginWhy(ctx, project, dataStatus);
        return this.handleUnknown(ctx, '', dataStatus);
      case 'project_card':
        if (project) return this.handleProjectCard(ctx, project, dataStatus);
        return this.handleUnknown(ctx, '', dataStatus);
      default:
        return this.handleUnknown(ctx, '', dataStatus);
    }
  }

  // ------------------------------------------------------------------
  // 文脈フォローアップ
  // ------------------------------------------------------------------

  private async tryFollowUp(
    ctx: ToolContext,
    message: string,
    context: ConversationContext,
    principal: Principal,
    state: ExecutionState,
    dataStatus: DataStatus
  ): Promise<HandlerResult | null> {
    const contextProject = context.lastProjectId
      ? ctx.dataset.projects.find((p) => p.projectId === context.lastProjectId)
      : undefined;

    // スコープ切替の追い質問: 「グループ全体では？」「LCCだけなら？」
    const scopeSwitch = this.matchScopeSwitch(ctx.dataset, message);
    if (scopeSwitch && context.lastIntent) {
      assertScopeAllowed(principal, scopeSwitch);
      const switched: ToolContext = { ...ctx, scope: scopeSwitch };
      return this.runIntent(context.lastIntent, switched, dataStatus, context.lastProjectId);
    }

    // 「2番目」「三番目」
    const ordinal = parseOrdinal(message);
    if (ordinal !== null && context.lastListItems.length > 0) {
      const item = context.lastListItems[ordinal - 1];
      if (!item) {
        return this.simpleText(
          `直前のリストは${context.lastListItems.length}件です。${ordinal}番目はありません。`,
          'unknown',
          'UNKNOWN',
          dataStatus
        );
      }
      const project = item.projectId
        ? ctx.dataset.projects.find((p) => p.projectId === item.projectId)
        : undefined;
      if (project) return this.handleProjectCard(ctx, project, dataStatus);
      return this.simpleText(
        `${ordinal}番目: ${item.label}`,
        context.lastIntent ?? 'unknown',
        'HIGH',
        dataStatus
      );
    }

    // 「一番危ないのは？」（直前の話題に関わらずリスクランキング上位）
    if (/一番.{0,4}(危な|やば|まず)/.test(message)) {
      const risky = await this.handleRiskyProjects(ctx, dataStatus);
      const top = risky.listItems?.[0];
      if (top?.projectId) {
        const project = ctx.dataset.projects.find((p) => p.projectId === top.projectId);
        if (project) {
          const card = await this.handleMarginWhy(ctx, project, dataStatus);
          return { ...card, listItems: risky.listItems, listShown: 1 };
        }
      }
      return risky;
    }

    // 「その案件詳しく」「それ詳しく」「さっきの」（「それで送って」等の動詞付き指示は除外）
    if (
      /^(それ|その案件|さっきの|これ|この案件)(について|を)?(詳しく|教えて|どう)?？?$/.test(
        message
      ) &&
      contextProject
    ) {
      if (/詳しく|教えて/.test(message))
        return this.handleMarginWhy(ctx, contextProject, dataStatus);
      return this.handleProjectCard(ctx, contextProject, dataStatus);
    }

    // 「なぜ利益落ちた？」「なぜ？」
    if (/なぜ(利益|粗利|落ち|悪)|^(なぜ|なんで)？?$/.test(message) && contextProject) {
      return this.handleMarginWhy(ctx, contextProject, dataStatus);
    }

    // 「担当は？」
    if (/担当(は|者|誰)/.test(message) && contextProject) {
      const owner = ctx.dataset.employees.find(
        (e) => e.employeeId === contextProject.ownerEmployeeId
      );
      return this.simpleText(
        owner
          ? `【確認できた事実】${contextProject.name}の担当は${owner.name}（${owner.role}）です。`
          : `【確認できた事実】${contextProject.name}に担当者が登録されていません。担当者情報の入力が必要です。`,
        'project_card',
        owner ? 'HIGH' : 'UNKNOWN',
        dataStatus,
        contextProject.projectId
      );
    }

    // 「どうすればいい？」「対策は？」
    if (/どうすれば|対策(は|ある)|どうしたら|どうする？?$/.test(message)) {
      return this.handleAdvice(ctx, message, context, dataStatus);
    }

    // 「もっと詳しく」
    if (/もっと詳しく|詳細(を|は)?/.test(message) && context.lastIntent) {
      if (contextProject) return this.handleMarginWhy(ctx, contextProject, dataStatus);
      if (context.lastIntent === 'cash') return this.handleCashDetail(ctx, dataStatus);
      if (context.lastIntent === 'sales') return this.runIntent('pipeline', ctx, dataStatus);
      return this.runIntent(context.lastIntent, ctx, dataStatus, context.lastProjectId);
    }

    // 「それどこから？」（Memory Provenance）
    if (/どこから|出典(は|を)/.test(message) && context.lastMemoryIds.length > 0) {
      const memories = await this.repository.getMemories();
      const targets = context.lastMemoryIds
        .map((id) => memories.find((m) => m.memoryId === id))
        .filter((m) => m !== undefined)
        .slice(0, 3);
      if (targets.length > 0) {
        const lines = targets.flatMap((m) => [
          `「${m.statement}」の出典:`,
          `・ソース: ${m.source}${m.sourceTimestamp ? `（${m.sourceTimestamp.slice(0, 10)}）` : ''} / 記録者: ${m.createdBy} / 確信度: ${m.confidence}`,
          ...m.evidence.slice(0, 3).map((ev) => `・${ev.label}: ${ev.value}（${ev.source}）`)
        ]);
        return {
          response: {
            text: lines.join('\n'),
            dataStatus,
            uiHint: 'text',
            confidence: 'HIGH',
            evidence: targets.flatMap((m) => m.evidence).slice(0, 6),
            toolsUsed: ['memory_search']
          },
          intent: 'memory_recall',
          memoryIds: context.lastMemoryIds
        };
      }
    }

    // 「根拠は？」
    if (/根拠(は|を|ある|見せ|教え)/.test(message)) {
      if (context.lastEvidence.length === 0) {
        return this.simpleText(
          '直前の回答に紐づく根拠データがありません。',
          'unknown',
          'UNKNOWN',
          dataStatus
        );
      }
      const lines = [
        '直前の回答の根拠:',
        ...context.lastEvidence
          .slice(0, 10)
          .map((ev) => `・${ev.label}: ${ev.value}（${ev.source} / ${ev.asOf.slice(0, 10)}）`)
      ];
      return this.simpleText(
        lines.join('\n'),
        context.lastIntent ?? 'unknown',
        context.lastConfidence,
        dataStatus
      );
    }

    // 「本当に？」
    if (/本当(に|？)|ほんと|確か(なの|？)/.test(message) && context.lastIntent) {
      const lines = [
        `直前の回答のData Confidenceは${context.lastConfidence}です。`,
        `根拠データ${context.lastEvidence.length}件（決定論エンジンの計算結果。AI生成値は根拠に使用していません）。`,
        context.lastEvidence[0]
          ? `最も古い参照データ: ${context.lastEvidence.map((e) => e.asOf.slice(0, 10)).sort()[0]}`
          : 'ただし根拠データが紐づいていないため、この回答は断定できません。'
      ];
      return this.simpleText(
        lines.join('\n'),
        context.lastIntent,
        context.lastConfidence,
        dataStatus
      );
    }

    // 「他にない？」
    if (/他に(ない|は|ある)|ほかに/.test(message) && context.lastListItems.length > 0) {
      const rest = context.lastListItems.slice(context.lastListShown);
      if (rest.length === 0) {
        return this.simpleText(
          '現在のデータで確認できる範囲では、これ以上ありません。',
          context.lastIntent ?? 'unknown',
          'HIGH',
          dataStatus
        );
      }
      const shown = rest.slice(0, 3);
      return {
        response: {
          text: [
            '続き:',
            ...shown.map((item, i) => `${context.lastListShown + i + 1}. ${item.label}`)
          ].join('\n'),
          dataStatus,
          uiHint: 'ranking',
          confidence: 'HIGH',
          evidence: [],
          toolsUsed: []
        },
        intent: context.lastIntent ?? 'unknown',
        listItems: context.lastListItems,
        listShown: context.lastListShown + shown.length
      };
    }

    // 「逆に」（直前リストの逆順）
    if (/^逆に/.test(message) && context.lastListItems.length > 0) {
      const reversed = [...context.lastListItems].reverse();
      return {
        response: {
          text: [
            '逆順で表示します:',
            ...reversed.slice(0, 5).map((item, i) => `${i + 1}. ${item.label}`)
          ].join('\n'),
          dataStatus,
          uiHint: 'ranking',
          confidence: 'HIGH',
          evidence: [],
          toolsUsed: []
        },
        intent: context.lastIntent ?? 'unknown',
        listItems: reversed,
        listShown: Math.min(5, reversed.length)
      };
    }

    // 「去年と比べて」: 履歴ソース未接続のため正直にUNKNOWN
    if (/去年|昨年|前年/.test(message)) {
      return this.simpleText(
        [
          '【確認できた事実】前年データのソース（会計システム）は未接続のため、前年比較はできません。',
          '推測での比較は行いません。Phase Bで会計データ接続後に対応します。'
        ].join('\n'),
        context.lastIntent ?? 'unknown',
        'UNKNOWN',
        dataStatus
      );
    }

    void state;
    return null;
  }

  private matchScopeSwitch(dataset: CommandDataset, message: string): CompanyScope | null {
    if (/グループ(全体|では|なら)/.test(message)) return 'group';
    for (const company of dataset.companies) {
      const base = company.name.replace(/株式会社|（.*?）/g, '');
      if (
        (base.length >= 2 &&
          message.includes(base.slice(0, 2)) &&
          /(だけ|のみ|では|なら)/.test(message)) ||
        message.includes(`${company.companyId}だけ`)
      ) {
        return company.companyId;
      }
    }
    if (/福祉(だけ|のみ|では|なら)/.test(message)) {
      const wel = dataset.companies.find((c) => c.name.includes('福祉'));
      if (wel) return wel.companyId;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // 複合質問（Planner → Tool Selection → Synthesis）
  // ------------------------------------------------------------------

  private async tryCompound(
    ctx: ToolContext,
    message: string,
    state: ExecutionState,
    dataStatus: DataStatus
  ): Promise<HandlerResult | null> {
    const domains: Array<{ key: 'cash' | 'sales' | 'invoices' | 'risky'; pattern: RegExp }> = [
      { key: 'cash', pattern: /資金繰り|現金|資金|キャッシュ/ },
      { key: 'sales', pattern: /売上|着地/ },
      { key: 'invoices', pattern: /請求|入金/ },
      { key: 'risky', pattern: /粗利|案件リスク/ }
    ];
    const matched = domains.filter((domain) => domain.pattern.test(message));
    const needsSynthesis = /一番|最も|まとめ|総合|教えて/.test(message);
    if (matched.length < 2 || !needsSynthesis) return null;

    const sections: string[] = [];
    const evidence: CommandChatResponse['evidence'] = [];
    const toolsUsed: string[] = [];
    const dangers: Array<{ score: number; text: string }> = [];

    const callTool = <T>(name: string, fn: () => T): T => {
      state.toolCalls += 1;
      state.steps += 1;
      if (
        state.toolCalls > ORCHESTRATOR_LIMITS.maxToolCalls ||
        state.steps > ORCHESTRATOR_LIMITS.maxSteps ||
        Date.now() - state.startedAtMs > ORCHESTRATOR_LIMITS.timeoutMs
      ) {
        throw new Error('orchestrator limits exceeded');
      }
      toolsUsed.push(name);
      return fn();
    };

    try {
      if (matched.some((m) => m.key === 'cash')) {
        const cash = callTool('get_cash_forecast', () =>
          computeCashForecast(ctx.dataset, ctx.scope)
        );
        sections.push(
          `【資金繰り】現預金${yen(cash.currentBalance)}、30日後${yen(horizonBalance(cash, 30))}、期間最低${yen(cash.minBalance.balance)}（${cash.minBalance.date}）。`
        );
        evidence.push(...cash.evidence.slice(0, 3));
        if (cash.minBalance.balance < 0)
          dangers.push({
            score: 100,
            text: `資金ショートの恐れ（${cash.minBalance.date}に${yen(cash.minBalance.balance)}）`
          });
        else if (cash.minBalance.balance < cash.currentBalance * 0.6)
          dangers.push({
            score: 60,
            text: `現金残高が${cash.minBalance.date}に${yen(cash.minBalance.balance)}まで低下`
          });
      }
      if (matched.some((m) => m.key === 'sales')) {
        const sales = callTool('get_sales_summary', () =>
          computeSalesSummary(ctx.dataset, ctx.scope)
        );
        sections.push(
          `【売上】確定${yen(sales.confirmedSales)} / 着地予測${yen(sales.landingForecast)}${
            sales.targetGapRate !== null ? `（目標比${pct(sales.targetGapRate)}）` : ''
          }。`
        );
        evidence.push(...sales.evidence.slice(0, 3));
        if (sales.targetGapRate !== null && sales.targetGapRate < 0) {
          dangers.push({
            score: 50 + Math.abs(sales.targetGapRate) * 300,
            text: `売上着地が目標比${pct(sales.targetGapRate)}（不足${yen(sales.shortfall ?? 0)}）`
          });
        }
      }
      if (matched.some((m) => m.key === 'invoices')) {
        const invoices = callTool('get_invoice_status', () =>
          checkInvoices(ctx.dataset, ctx.scope)
        );
        sections.push(
          `【請求】要確認${invoices.issues.length}件（完工未請求${yen(invoices.uninvoicedCompletedTotal)}）。`
        );
        if (invoices.uninvoicedCompletedTotal > 0)
          dangers.push({ score: 40, text: `完工未請求${yen(invoices.uninvoicedCompletedTotal)}` });
      }
      const alerts = callTool('get_alerts', () =>
        activeAlerts(buildAlerts(ctx.dataset, ctx.scope, ctx.store.decisions))
      );
      for (const alert of alerts.filter((a) => a.severity === 'CRITICAL'))
        dangers.push({ score: 120, text: alert.title });
    } catch {
      sections.push('（一部の分析は実行上限に達したため省略しました）');
    }

    const top = dangers.sort((a, b) => b.score - a.score)[0];
    const text = [
      ...sections,
      '',
      top
        ? `【最重要】現在のデータで最も危険なのは「${top.text}」です。`
        : '【最重要】現在のデータでは重大な危険は検出されていません。'
    ].join('\n');

    return {
      response: {
        text,
        dataStatus,
        uiHint: 'ranking',
        confidence: 'HIGH',
        evidence: evidence.slice(0, 10),
        toolsUsed
      },
      intent: 'compound'
    };
  }

  // ------------------------------------------------------------------
  // 個別ハンドラ
  // ------------------------------------------------------------------

  private simpleText(
    text: string,
    intent: IntentKey,
    confidence: CommandChatResponse['confidence'],
    dataStatus: DataStatus,
    projectId?: string | null
  ): HandlerResult {
    return {
      response: { text, dataStatus, uiHint: 'text', confidence, evidence: [], toolsUsed: [] },
      intent,
      projectId
    };
  }

  private async handleBrief(ctx: ToolContext, dataStatus: DataStatus): Promise<HandlerResult> {
    // Daily Learning Summary + ランク上位の気づきをBriefへ載せる（§14/§16。上位のみ）
    const today = jstDate(ctx.dataset.asOf);
    const briefPrincipal: Principal = { role: 'PRESIDENT', companyIds: [], label: 'brief' };
    const memories = await this.memoryService.search({ limit: 300 }, briefPrincipal);
    const todays = memories.filter((m) => jstDate(m.createdAt) === today);
    const learning = {
      learnedToday: todays
        .filter((m) => m.reviewStatus !== 'PENDING_REVIEW')
        .slice(0, 5)
        .map((m) => `[${m.type}] ${m.statement}`),
      pendingReview: todays
        .filter((m) => m.reviewStatus === 'PENDING_REVIEW')
        .slice(0, 3)
        .map((m) => m.statement),
      topInsights: rankInsights(discoverProblems(ctx.dataset, ctx.scope))
        .slice(0, 2)
        .map((insight) => insight.text)
    };
    const brief = generateExecutiveBrief(ctx.dataset, ctx.scope, ctx.store.decisions, learning);
    return {
      response: {
        text: brief.text,
        dataStatus,
        uiHint: 'brief',
        data: brief,
        confidence: 'HIGH',
        evidence: brief.alerts.flatMap((alert) => alert.evidence).slice(0, 10),
        toolsUsed: [
          'get_company_summary',
          'get_alerts',
          'get_cash_forecast',
          'get_sales_leaks',
          'get_invoice_status'
        ]
      },
      intent: 'brief',
      listItems: brief.alerts.map((alert) => ({
        id: alert.alertId,
        kind: 'alert' as const,
        label: alert.title,
        projectId: alert.projectId
      })),
      listShown: brief.decisionsNeeded.length
    };
  }

  private async handleSales(ctx: ToolContext, dataStatus: DataStatus): Promise<HandlerResult> {
    const sales = computeSalesSummary(ctx.dataset, ctx.scope);
    const lines = [
      '【確認できた事実】',
      `${scopeLabel(ctx.dataset, ctx.scope)}: ${sales.month}の確定売上は${yen(sales.confirmedSales)}、着地予測は${yen(sales.landingForecast)}です。`
    ];
    if (sales.target !== null && sales.targetGapRate !== null) {
      lines.push(
        `目標${yen(sales.target)}に対し${pct(sales.targetGapRate)}${sales.targetGapRate < 0 ? `（不足額${yen(sales.shortfall ?? 0)}）` : ''}です。`
      );
    } else {
      lines.push('当月の売上目標が設定されていないため、目標比は算出できません。');
    }
    if (sales.pipeline.length > 0) {
      lines.push(
        '',
        `見積提出済みで受注可能性のある案件が${sales.pipeline.length}件、総額${yen(sales.pipelineTotal)}あります。`,
        '上位3件:',
        ...sales.pipeline
          .slice(0, 3)
          .map(
            (item, i) =>
              `${i + 1}. ${item.projectName}（${item.customerName}）${yen(item.amount)} / 受注確度${pct(item.probability)}`
          )
      );
    }
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'chart',
        data: sales,
        confidence: 'HIGH',
        evidence: sales.evidence,
        toolsUsed: ['get_sales_summary', 'get_pipeline']
      },
      intent: 'sales',
      listItems: sales.pipeline.map((item) => ({
        id: item.projectId,
        kind: 'pipeline' as const,
        label: `${item.projectName}（${item.customerName}）${yen(item.amount)}`,
        projectId: item.projectId
      })),
      listShown: 3
    };
  }

  private async handleCash(ctx: ToolContext, dataStatus: DataStatus): Promise<HandlerResult> {
    const cash = computeCashForecast(ctx.dataset, ctx.scope);
    if (!cash.balanceKnown) {
      return this.simpleText(
        [
          '【確認できた事実】このスコープの銀行残高データが取得できていません。',
          '残高不明のため「資金繰りに問題なし」とは判断できません。データ接続を確認してください。'
        ].join('\n'),
        'cash',
        'UNKNOWN',
        dataStatus
      );
    }
    const staleWarning =
      cash.freshnessStatus === 'VERY_STALE'
        ? `\n⚠ 残高データは${cash.freshness.lastUpdatedAt.slice(0, 10)}時点のもので大幅に古く、現在値として断定できません。`
        : cash.freshnessStatus !== 'FRESH'
          ? `（注意: 残高は${cash.freshness.source}のもので最新ではありません）`
          : '';
    const text = [
      '【確認できた事実】',
      `現預金は${yen(cash.currentBalance)}です${cash.freshnessStatus === 'VERY_STALE' ? '' : staleWarning}。${cash.freshnessStatus === 'VERY_STALE' ? staleWarning : ''}`,
      `予測残高: 7日後${yen(horizonBalance(cash, 7))} / 30日後${yen(horizonBalance(cash, 30))} / 60日後${yen(horizonBalance(cash, 60))} / 90日後${yen(horizonBalance(cash, 90))}`,
      `期間中の最低残高は${cash.minBalance.date}の${yen(cash.minBalance.balance)}です。`,
      '',
      '計算は「現在現預金＋入金予定－支払予定」の決定論ロジックで、確定（CONFIRMED）・予定（EXPECTED）・推計（ESTIMATED）を区別しています。',
      '「A社の入金が10日遅れたら？」のようなシナリオも再計算できます。'
    ].join('\n');
    return {
      response: {
        text,
        dataStatus,
        uiHint: 'cash_table',
        data: cash,
        confidence:
          cash.freshnessStatus === 'FRESH'
            ? 'HIGH'
            : cash.freshnessStatus === 'VERY_STALE'
              ? 'LOW'
              : 'MEDIUM',
        evidence: cash.evidence,
        toolsUsed: ['get_cash_position', 'get_cash_forecast']
      },
      intent: 'cash'
    };
  }

  private async handleCashDetail(ctx: ToolContext, dataStatus: DataStatus): Promise<HandlerResult> {
    const cash = computeCashForecast(ctx.dataset, ctx.scope);
    const lines = [
      '【確認できた事実】今後90日の入出金予定（日付順）:',
      ...cash.entries
        .slice(0, 10)
        .map(
          (entry) =>
            `・${entry.date} ${entry.direction === 'in' ? '入金' : '支払'} ${yen(entry.amount)} ${entry.label}（${entry.status}）`
        ),
      cash.entries.length > 10 ? `…ほか${cash.entries.length - 10}件` : ''
    ].filter(Boolean);
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'cash_table',
        data: cash,
        confidence: 'HIGH',
        evidence: cash.evidence.slice(0, 10),
        toolsUsed: ['get_cash_forecast']
      },
      intent: 'cash'
    };
  }

  private async handleCashScenario(
    ctx: ToolContext,
    message: string,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const adjustments: CashScenarioAdjustment[] = [];
    const notes: string[] = [];

    const delayMatch = message.match(/(\d+)日遅れ/);
    if (delayMatch && /入金/.test(message)) {
      const days = Number(delayMatch[1]);
      const scoped = filterDatasetByScope(ctx.dataset, ctx.scope);
      const customer = findCustomer(ctx.dataset, message);
      const candidates = scoped.cashPlans
        .filter((plan) => plan.direction === 'in')
        .filter((plan) =>
          customer ? plan.label.includes(customer.name.replace(/株式会社/g, '').slice(0, 2)) : true
        )
        .sort((a, b) => b.amount - a.amount);
      const target = candidates[0];
      if (target) {
        adjustments.push({ kind: 'delay_entry', planId: target.planId, days });
        notes.push(`「${target.label}」${yen(target.amount)}の入金を${days}日遅らせた場合`);
      }
    }

    const buyMatch = message.match(/(\d+(?:,\d{3})*)万円/);
    if (buyMatch && /(買|購入|使)/.test(message)) {
      const amount = Number(buyMatch[1].replace(/,/g, '')) * 10_000;
      const paymentDate = new Date(ctx.dataset.asOf);
      paymentDate.setUTCDate(paymentDate.getUTCDate() + 30);
      adjustments.push({
        kind: 'add_payment',
        amount,
        date: paymentDate.toISOString().slice(0, 10),
        label: '想定支出'
      });
      notes.push(`30日後に${yen(amount)}の支出を追加した場合`);
    }

    if (adjustments.length === 0) {
      return this.simpleText(
        'シナリオ条件を特定できませんでした。「○○の入金が10日遅れたら？」「来月500万円の車両を買ったら？」のように金額または日数を含めてください。',
        'cash_scenario',
        'UNKNOWN',
        dataStatus
      );
    }

    const base = computeCashForecast(ctx.dataset, ctx.scope);
    const scenario = computeCashForecast(ctx.dataset, ctx.scope, adjustments);
    const diff = diffCashForecast(base, scenario);
    const text = [
      `【計算結果】${notes.join('、')}:`,
      ...diff.horizonDiffs
        .filter((h) => h.diff !== 0 || h.daysAhead === 30)
        .map(
          (h) =>
            `${h.daysAhead}日後残高 ${yen(h.base)} → ${yen(h.scenario)}（${h.diff >= 0 ? '+' : ''}${yen(h.diff)}）`
        ),
      `期間中最低残高 ${yen(diff.minBalanceBase.balance)}（${diff.minBalanceBase.date}） → ${yen(diff.minBalanceScenario.balance)}（${diff.minBalanceScenario.date}）`,
      '',
      scenario.minBalance.balance < 0
        ? '【AIの推測】この条件では資金ショートの恐れがあります。入金前倒しか支払時期の調整を検討してください。'
        : '【AIの推測】この条件でも残高はプラス圏ですが、他の支払遅延が重なる場合は再確認が必要です。'
    ].join('\n');
    return {
      response: {
        text,
        dataStatus,
        uiHint: 'cash_table',
        data: { base, scenario, adjustments, diff },
        confidence: 'MEDIUM',
        evidence: scenario.evidence,
        toolsUsed: ['get_cash_forecast']
      },
      intent: 'cash_scenario'
    };
  }

  private async handleRiskyProjects(
    ctx: ToolContext,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const deteriorations = findMarginDeteriorations(ctx.dataset, ctx.scope);
    const alerts = activeAlerts(buildAlerts(ctx.dataset, ctx.scope, ctx.store.decisions));
    if (deteriorations.length === 0) {
      return this.simpleText(
        '【確認できた事実】現在、予定粗利から大きく悪化している進行中案件はありません。',
        'risky',
        'HIGH',
        dataStatus
      );
    }
    const lines = [
      '【確認できた事実】粗利が予定から悪化している案件:',
      ...deteriorations.map(
        (item, i) =>
          `${i + 1}. ${item.margin.projectName}: 予定${pct(item.margin.plannedMarginRate)} → 予測${pct(item.margin.forecastMarginRate as number)}（主因: ${
            item.margin.varianceDrivers
              .map((driver) => `${driver.label}費+${yen(driver.diff)}`)
              .join('、') || '要確認'
          }）`
      )
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'ranking',
        data: { deteriorations, alerts: alerts.filter((alert) => alert.kind === 'margin_drop') },
        confidence: 'HIGH',
        evidence: deteriorations.flatMap((item) => item.margin.evidence).slice(0, 10),
        toolsUsed: ['get_project_margin', 'get_alerts']
      },
      intent: 'risky',
      projectId: deteriorations[0].margin.projectId,
      listItems: deteriorations.map((item) => ({
        id: item.margin.projectId,
        kind: 'project' as const,
        label: `${item.margin.projectName}（予測粗利${pct(item.margin.forecastMarginRate as number)}）`,
        projectId: item.margin.projectId
      })),
      listShown: deteriorations.length
    };
  }

  private async handleMarginWhy(
    ctx: ToolContext,
    project: Project,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const margin = computeProjectMargin(ctx.dataset, project);
    if (margin.forecastMarginRate === null) {
      return {
        response: {
          text: `【確認できた事実】${project.name}には原価データが登録されておらず、粗利は算出できません。`,
          dataStatus,
          uiHint: 'project_card',
          data: margin,
          confidence: 'UNKNOWN',
          evidence: margin.evidence,
          toolsUsed: ['get_project_margin']
        },
        intent: 'margin_why',
        projectId: project.projectId,
        customerId: project.customerId
      };
    }
    const drivers = margin.varianceDrivers;
    const hasSubcontractOverrun = drivers.some((driver) => driver.category === 'subcontract');
    const lines = [
      '【確認できた事実】',
      `${project.name}の予測粗利率は${pct(margin.forecastMarginRate)}（予定${pct(margin.plannedMarginRate)}）です。`,
      '',
      '【主因】',
      ...(drivers.length > 0
        ? drivers.map((driver) => `${driver.label}費が見積比＋${yen(driver.diff)}`)
        : ['見積比で超過しているカテゴリはありません']),
      '',
      '【AIの推測】',
      hasSubcontractOverrun
        ? '追加作業が原価増加の一因である可能性があります。'
        : '数量・単価の見積差異が要因の可能性があります。',
      '',
      '【推奨】',
      '追加請求可能性を確認してください。'
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'project_card',
        data: margin,
        confidence: 'HIGH',
        evidence: margin.evidence,
        toolsUsed: ['get_project_margin']
      },
      intent: 'margin_why',
      projectId: project.projectId,
      customerId: project.customerId
    };
  }

  private async handleProjectCard(
    ctx: ToolContext,
    project: Project,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const margin = computeProjectMargin(ctx.dataset, project);
    const scoped = filterDatasetByScope(ctx.dataset, ctx.scope);
    const customer = scoped.customers.find((item) => item.customerId === project.customerId);
    const owner = ctx.dataset.employees.find((e) => e.employeeId === project.ownerEmployeeId);
    const lines = [
      '【確認できた事実】',
      `${project.name}（${customer?.name ?? '顧客不明'}）: ステージ ${project.stage}、受注額${yen(project.orderAmount)}。`,
      margin.forecastMarginRate !== null
        ? `予測粗利率${pct(margin.forecastMarginRate)}（予定${pct(margin.plannedMarginRate)}）。`
        : '原価データ未登録のため粗利は算出できません。',
      project.dueDate ? `完工予定 ${project.dueDate}。` : '',
      owner ? `担当: ${owner.name}。` : ''
    ].filter(Boolean);
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'project_card',
        data: { project, margin, customer },
        confidence: margin.forecastMarginRate !== null ? 'HIGH' : 'MEDIUM',
        evidence: margin.evidence,
        toolsUsed: ['get_project_margin']
      },
      intent: 'project_card',
      projectId: project.projectId,
      customerId: project.customerId
    };
  }

  private async handleEmployeeProjects(
    ctx: ToolContext,
    employeeId: string,
    name: string,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const scoped = filterDatasetByScope(ctx.dataset, ctx.scope);
    const projects = scoped.projects.filter((project) => project.ownerEmployeeId === employeeId);
    const interactions = scoped.interactions.filter(
      (interaction) => interaction.employeeId === employeeId
    );
    if (projects.length === 0 && interactions.length === 0) {
      return this.simpleText(
        `【確認できた事実】${name}さんが担当として登録されている案件・接点記録は現在のデータにありません。担当者情報が未入力の可能性があります。`,
        'employee',
        'UNKNOWN',
        dataStatus
      );
    }
    const lines = [
      '【確認できた事実】',
      `${name}さんの担当案件は${projects.length}件です。`,
      ...projects.map(
        (project) =>
          `・${project.name}（${project.stage}${project.dueDate ? `、完工予定${project.dueDate}` : ''}）`
      ),
      ...(interactions.length > 0
        ? [
            '',
            `直近の接点: ${interactions.sort((a, b) => b.datetime.localeCompare(a.datetime))[0].summary}`
          ]
        : [])
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'pipeline',
        data: { projects, interactions },
        confidence: 'HIGH',
        evidence: projects.map((project) => ({
          label: project.name,
          value: project.stage,
          refId: project.projectId,
          source: '案件台帳',
          asOf: project.updatedAt
        })),
        toolsUsed: ['get_interactions']
      },
      intent: 'employee',
      projectId: projects[0]?.projectId ?? null,
      listItems: projects.map((p) => ({
        id: p.projectId,
        kind: 'project' as const,
        label: p.name,
        projectId: p.projectId
      })),
      listShown: projects.length
    };
  }

  private async handleInvoices(ctx: ToolContext, dataStatus: DataStatus): Promise<HandlerResult> {
    const result = checkInvoices(ctx.dataset, ctx.scope);
    if (result.issues.length === 0) {
      return this.simpleText(
        '【確認できた事実】完工未請求・期日超過・金額不一致は検出されませんでした。',
        'invoices',
        'HIGH',
        dataStatus
      );
    }
    const lines = [
      `【確認できた事実】請求・入金の要確認が${result.issues.length}件あります。`,
      ...result.issues.map((issue, i) => `${i + 1}. ${issue.title} — ${issue.detail}`)
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'ranking',
        data: result,
        confidence: 'HIGH',
        evidence: result.issues.flatMap((issue) => issue.evidence),
        toolsUsed: ['get_invoice_status']
      },
      intent: 'invoices',
      listItems: result.issues.map((issue, i) => ({
        id: issue.invoiceId ?? issue.projectId ?? String(i),
        kind: 'alert' as const,
        label: issue.title,
        projectId: issue.projectId
      })),
      listShown: result.issues.length
    };
  }

  private async handleToday(ctx: ToolContext, dataStatus: DataStatus): Promise<HandlerResult> {
    const leaks = detectSalesLeaks(ctx.dataset, ctx.scope);
    const alerts = activeAlerts(buildAlerts(ctx.dataset, ctx.scope, ctx.store.decisions));
    const waiting = ctx.store.approvals.filter((approval) => approval.status === 'waiting');
    const urgent = alerts.filter(
      (alert) => alert.severity === 'CRITICAL' || alert.severity === 'WARNING'
    );
    const lines = [
      '【本日の要対応（優先順）】',
      ...urgent.slice(0, 3).map((alert, i) => `${i + 1}. ${alert.title}`),
      ...leaks
        .slice(0, 3)
        .map(
          (leak, i) => `${urgent.slice(0, 3).length + i + 1}. ${leak.title}（${leak.customerName}）`
        ),
      ...(waiting.length > 0 ? ['', `承認待ちが${waiting.length}件あります。`] : [])
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'tasks',
        data: { alerts: urgent, leaks, approvalsWaiting: waiting },
        confidence: 'HIGH',
        evidence: [
          ...urgent.flatMap((alert) => alert.evidence),
          ...leaks.flatMap((leak) => leak.evidence)
        ].slice(0, 10),
        toolsUsed: ['get_alerts', 'get_sales_leaks']
      },
      intent: 'today',
      listItems: [
        ...urgent.map((a) => ({
          id: a.alertId,
          kind: 'alert' as const,
          label: a.title,
          projectId: a.projectId
        })),
        ...leaks.map((l) => ({
          id: l.projectId,
          kind: 'leak' as const,
          label: `${l.title}（${l.customerName}）`,
          projectId: l.projectId
        }))
      ],
      listShown: Math.min(3, urgent.length) + Math.min(3, leaks.length)
    };
  }

  private async handlePipeline(ctx: ToolContext, dataStatus: DataStatus): Promise<HandlerResult> {
    const outlook = computeNextMonthOutlook(ctx.dataset, ctx.scope);
    const lines = [
      '【確認できた事実】',
      `来月以降に完工予定・未完工の受注済み案件は${outlook.scheduledProjects.length}件、合計${yen(outlook.scheduledAmount)}です。`,
      `見積提出済みパイプラインは${outlook.pipeline.length}件、総額${yen(outlook.pipeline.reduce((sum, item) => sum + item.amount, 0))}です。`,
      '',
      '【AIの推測】',
      '受注確度の高い案件から追客すると、来月の稼働不足リスクを下げられます。'
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'pipeline',
        data: outlook,
        confidence: 'MEDIUM',
        evidence: outlook.scheduledProjects.map((project) => ({
          label: project.name,
          value: yen(project.orderAmount),
          refId: project.projectId,
          source: '案件台帳',
          asOf: project.updatedAt
        })),
        toolsUsed: ['get_pipeline', 'get_sales_summary']
      },
      intent: 'pipeline',
      listItems: outlook.pipeline.map((item) => ({
        id: item.projectId,
        kind: 'pipeline' as const,
        label: `${item.projectName}（${item.customerName}）${yen(item.amount)}`,
        projectId: item.projectId
      })),
      listShown: 0
    };
  }

  private async handleTodaySites(ctx: ToolContext, dataStatus: DataStatus): Promise<HandlerResult> {
    const today = jstDate(ctx.dataset.asOf);
    const scoped = filterDatasetByScope(ctx.dataset, ctx.scope);
    const assignments = scoped.assignments.filter((a) => a.date === today);
    if (assignments.length === 0) {
      return this.simpleText(
        '【確認できた事実】本日の配置データが登録されていません。配置板データが未接続または未入力の可能性があります。推測では回答しません。',
        'schedule',
        'UNKNOWN',
        dataStatus
      );
    }
    const bySite = new Map<string, string[]>();
    for (const a of assignments) {
      bySite.set(a.siteName, [...(bySite.get(a.siteName) ?? []), a.employeeName]);
    }
    const lines = [
      `【確認できた事実】本日（${today}）の予定配置は${bySite.size}現場です。`,
      ...[...bySite.entries()].map(([site, people]) => `・${site}: ${people.join('、')}`),
      '',
      '※これは配置板の「予定」です。実績は日報で確認してください。'
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'tasks',
        data: { assignments },
        confidence: 'HIGH',
        evidence: assignments.map((a) => ({
          label: `予定配置 ${a.siteName}`,
          value: `${a.date} ${a.employeeName}`,
          refId: a.assignmentId,
          source: 'デジタル配置板（予定）',
          asOf: ctx.dataset.asOf
        })),
        toolsUsed: ['get_schedule']
      },
      intent: 'schedule',
      listItems: assignments.map((a) => ({
        id: a.assignmentId,
        kind: 'project' as const,
        label: `${a.siteName}（${a.employeeName}）`,
        projectId: a.projectId
      })),
      listShown: assignments.length
    };
  }

  private async handleYesterdayReports(
    ctx: ToolContext,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const yesterday = addDaysJst(jstDate(ctx.dataset.asOf), -1);
    const scoped = filterDatasetByScope(ctx.dataset, ctx.scope);
    const reports = scoped.dailyReports.filter((r) => r.date === yesterday);
    if (reports.length === 0) {
      const planned = scoped.assignments.filter((a) => a.date === yesterday);
      return this.simpleText(
        planned.length > 0
          ? `【確認できた事実】昨日（${yesterday}）の実績日報が未提出です。予定配置は${planned.length}件ありました（${planned.map((a) => `${a.siteName}:${a.employeeName}`).join('、')}）が、予定を実績として扱うことはできません。`
          : `【確認できた事実】昨日（${yesterday}）の日報・配置データがありません。推測では回答しません。`,
        'schedule',
        'UNKNOWN',
        dataStatus
      );
    }
    const lines = [
      `【確認できた事実】昨日（${yesterday}）の実績日報は${reports.length}件です。`,
      ...reports.map(
        (r) =>
          `・${r.siteName}: ${r.employeeName}（${r.manDays}人工${r.workDescription ? `、${r.workDescription}` : ''}）`
      )
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'tasks',
        data: { reports },
        confidence: 'HIGH',
        evidence: reports.map((r) => ({
          label: `実績日報 ${r.siteName}`,
          value: `${r.date} ${r.employeeName} ${r.manDays}人工`,
          refId: r.reportId,
          source: '実績日報',
          asOf: ctx.dataset.asOf
        })),
        toolsUsed: ['get_daily_reports']
      },
      intent: 'schedule',
      listItems: reports.map((r) => ({
        id: r.reportId,
        kind: 'project' as const,
        label: `${r.siteName}（${r.employeeName}）`,
        projectId: r.projectId
      })),
      listShown: reports.length
    };
  }

  private async handleLastContact(
    ctx: ToolContext,
    message: string,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const customer = findCustomer(ctx.dataset, message);
    if (!customer) {
      return this.simpleText(
        '【確認できた事実】該当する顧客を特定できませんでした。顧客名を含めて質問してください。',
        'last_contact',
        'UNKNOWN',
        dataStatus
      );
    }
    const interactions = ctx.dataset.interactions
      .filter((interaction) => interaction.customerId === customer.customerId)
      .sort((a, b) => b.datetime.localeCompare(a.datetime));
    if (interactions.length === 0) {
      return this.simpleText(
        `【確認できた事実】${customer.name}との接点記録は現在のデータにありません。電話・一部チャット履歴は構造化されていないため、接点がなかったとは断定できません。`,
        'last_contact',
        'UNKNOWN',
        dataStatus
      );
    }
    const byChannel = new Map<string, string>();
    for (const interaction of interactions) {
      if (!byChannel.has(interaction.channel))
        byChannel.set(interaction.channel, interaction.datetime.slice(0, 10));
    }
    const lines = [
      `全チャネルを含む${customer.name}との最終接点日は、現在のデータでは確定できません。`,
      '',
      '確認できる範囲では、',
      ...[...byChannel.entries()].map(
        ([channel, date]) =>
          `${channel === 'gmail' ? 'Gmail' : channel === 'manual' ? '案件記録' : channel}：${date}`
      ),
      '',
      `電話および一部チャット履歴が構造化されていないため、${interactions[0].datetime.slice(0, 10)}を最終接点とは断定できません。`
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'text',
        data: { customer, interactions },
        confidence: 'LOW',
        evidence: interactions.map((interaction) => ({
          label: `${interaction.channel} 接点`,
          value: `${interaction.datetime.slice(0, 10)} ${interaction.summary}`,
          refId: interaction.interactionId,
          source: '営業接点記録',
          asOf: interaction.datetime
        })),
        toolsUsed: ['get_interactions']
      },
      intent: 'last_contact',
      customerId: customer.customerId
    };
  }

  private async handleAdvice(
    ctx: ToolContext,
    message: string,
    context: ConversationContext,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const contextProject = context.lastProjectId
      ? ctx.dataset.projects.find((p) => p.projectId === context.lastProjectId)
      : undefined;
    const facts: string[] = [];
    const proposals: string[] = [];
    if (contextProject) {
      const margin = computeProjectMargin(ctx.dataset, contextProject);
      if (margin.forecastMarginRate !== null && margin.varianceDrivers.length > 0) {
        facts.push(
          `${contextProject.name}の予測粗利率は${pct(margin.forecastMarginRate)}（予定${pct(margin.plannedMarginRate)}）。`,
          ...margin.varianceDrivers.map((d) => `${d.label}費が見積比＋${yen(d.diff)}。`)
        );
        proposals.push(
          '追加作業分の追加請求可能性を発注者へ確認する。',
          `${margin.varianceDrivers[0].label}費の残り発注分の内訳・単価を精査する。`,
          '完工前に実行予算を再確定し、以降の原価計上と突き合わせる。'
        );
      }
    }
    if (facts.length === 0) {
      const alerts = activeAlerts(buildAlerts(ctx.dataset, ctx.scope, ctx.store.decisions)).slice(
        0,
        3
      );
      facts.push(...alerts.map((alert) => `${alert.title}。`));
      proposals.push('上記のうち金額影響が最大のものから着手することを推奨します。');
    }
    if (facts.length === 0) {
      return this.simpleText(
        '対象が特定できません。案件名や領域（資金・売上・請求）を指定してください。',
        'advice',
        'UNKNOWN',
        dataStatus
      );
    }
    const lines = [
      '【確認できた事実】',
      ...facts,
      '',
      '【AIの提案】',
      ...proposals.map((p) => `・${p}`),
      '',
      '※提案はAIの分析であり、最終判断は経営者が行ってください。'
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence: 'MEDIUM',
        evidence: context.lastEvidence.slice(0, 6),
        toolsUsed: ['get_project_margin', 'get_alerts']
      },
      intent: 'advice',
      projectId: contextProject?.projectId ?? null
    };
  }

  private async handleDraft(
    ctx: ToolContext,
    message: string,
    context: ConversationContext,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    if (!canRequestWrite(principal)) {
      return this.simpleText(
        `ロール${principal.role}には下書き作成（LEVEL 2）の権限がありません。`,
        'draft',
        'UNKNOWN',
        dataStatus
      );
    }
    const customer =
      findCustomer(ctx.dataset, message) ??
      (context.lastCustomerId
        ? ctx.dataset.customers.find((c) => c.customerId === context.lastCustomerId)
        : undefined);
    const project = context.lastProjectId
      ? ctx.dataset.projects.find((p) => p.projectId === context.lastProjectId)
      : undefined;
    if (!customer && !project) {
      return this.simpleText(
        '宛先が特定できません。顧客名または案件を先に指定してください。',
        'draft',
        'UNKNOWN',
        dataStatus
      );
    }
    const customerName = customer?.name ?? '関係者';
    const subject = project ? `${project.name.split('（')[0]}の件` : 'ご確認の件';
    const draftText = [
      `${customerName}様`,
      '',
      'いつもお世話になっております。株式会社LCCです。',
      `${subject}についてご連絡いたします。`,
      project
        ? `現在の進捗と今後の予定について、お打ち合わせの機会をいただけますと幸いです。`
        : '内容についてご確認をお願いいたします。',
      '',
      '※金額・納期・契約条件に関する記載は、承認前に必ず担当者が確認してください。'
    ].join('\n');
    return {
      response: {
        text: [
          '下書きを作成しました（LEVEL 2: 下書き作成のため承認不要。送信には承認が必要です）。',
          '----',
          draftText,
          '----',
          '「それで送って」と指示すると承認リクエスト（LEVEL 4）を作成します。'
        ].join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence: 'HIGH',
        evidence: project
          ? [
              {
                label: '関連案件',
                value: project.name,
                refId: project.projectId,
                source: '案件台帳',
                asOf: project.updatedAt
              }
            ]
          : [],
        toolsUsed: ['create_draft']
      },
      intent: 'draft',
      projectId: project?.projectId ?? null,
      customerId: customer?.customerId ?? null,
      draft: {
        text: draftText,
        customerName,
        customerId: customer?.customerId,
        projectId: project?.projectId
      }
    };
  }

  private async handleSendRequest(
    ctx: ToolContext,
    message: string,
    context: ConversationContext,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    if (!canRequestWrite(principal)) {
      return this.simpleText(
        `ロール${principal.role}には外部送信の承認リクエスト作成（LEVEL 4）の権限がありません。`,
        'send',
        'UNKNOWN',
        dataStatus
      );
    }
    const draft = context.lastDraft;
    const customer =
      findCustomer(ctx.dataset, message) ??
      (draft?.customerId
        ? ctx.dataset.customers.find((c) => c.customerId === draft.customerId)
        : undefined);
    const project =
      (draft?.projectId
        ? ctx.dataset.projects.find((p) => p.projectId === draft.projectId)
        : undefined) ?? findProject(ctx.dataset, message);
    const companyId =
      project?.companyId ?? customer?.companyId ?? (ctx.scope === 'group' ? 'lcc' : ctx.scope);
    const target = customer?.name ?? draft?.customerName ?? project?.name ?? '宛先未特定';
    const approval = await requestApproval(ctx, {
      companyId,
      riskLevel: 4,
      action: '外部メッセージ送信（dry-run）',
      target,
      before: undefined,
      after: draft ? draft.text.slice(0, 200) : undefined,
      aiReason: draft
        ? '直前に作成した下書きの送信依頼です。内容・宛先・根拠を確認のうえ承認してください。'
        : `経営者の指示「${message}」に基づく送信依頼です。下書き未確認のため、承認画面で内容を確認してください。`,
      evidence: project
        ? [
            {
              label: '関連案件',
              value: project.name,
              refId: project.projectId,
              source: '案件台帳',
              asOf: project.updatedAt
            }
          ]
        : []
    });
    await createTaskCandidate(ctx, {
      companyId,
      title: `承認待ちの送信を確認: ${target}`,
      projectId: project?.projectId,
      priority: 'high'
    });
    return {
      response: {
        text: [
          '外部送信はそのまま実行せず、承認リクエストを作成しました。',
          `宛先: ${target}`,
          draft
            ? `内容: 直前に作成した下書き（${draft.text.split('\n')[0]}…）`
            : '内容: 承認画面で確認してください。',
          '承認レベル: LEVEL 4（外部送信・データ変更）',
          '承認された場合のみ送信します（現在はdry-run運用のため実送信は行いません）。'
        ].join('\n'),
        dataStatus,
        uiHint: 'approval',
        data: approval,
        confidence: 'HIGH',
        evidence: approval.evidence,
        toolsUsed: ['request_approval'],
        approvalRequest: approval
      },
      intent: 'send',
      projectId: project?.projectId ?? null,
      customerId: customer?.customerId ?? null
    };
  }

  private async handleResearch(
    ctx: ToolContext,
    message: string,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    // Research Router: 社内で答えられるか / 外部調査か / 両方か
    const internalFacts: string[] = [];
    const customer = findCustomer(ctx.dataset, message);
    if (customer) {
      const interactions = ctx.dataset.interactions.filter(
        (i) => i.customerId === customer.customerId
      );
      internalFacts.push(
        `【社内事実】${customer.name}: 接点記録${interactions.length}件、関連案件${ctx.dataset.projects.filter((p) => p.customerId === customer.customerId).length}件。`
      );
    }
    const companyId =
      ctx.scope === 'group' ? (ctx.dataset.companies[0]?.companyId ?? 'group') : ctx.scope;
    const task = await requestResearch(ctx, { companyId, question: message });
    void principal;
    return {
      response: {
        text: [
          ...internalFacts,
          '【外部調査】外部調査タスクを受け付けました（非同期で実行します）。',
          `質問: ${message}`,
          `状態: ${task.status} / Provider: ${task.provider}`,
          '',
          '※外部調査の結果は出典URL・取得日時付きで返し、社内事実・AI分析と明確に分離して表示します。'
        ].join('\n'),
        dataStatus,
        uiHint: 'text',
        data: task,
        confidence: 'HIGH',
        evidence: [],
        toolsUsed: ['request_research']
      },
      intent: 'research',
      customerId: customer?.customerId ?? null
    };
  }

  // ------------------------------------------------------------------
  // Persistent Memory / Innovation / General（Phase M）
  // ------------------------------------------------------------------

  private async handleCorrection(
    ctx: ToolContext,
    message: string,
    context: ConversationContext,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const targetId = context.lastMemoryIds[0];
    const memories = await this.repository.getMemories();
    const target = memories.find((m) => m.memoryId === targetId);
    if (!target) {
      return this.simpleText(
        'どの記憶についての訂正か特定できませんでした。「前に◯◯って言ってた件」のように対象を呼び出してから訂正してください。',
        'memory_recall',
        'UNKNOWN',
        dataStatus
      );
    }
    const now = ctx.dataset.asOf;
    const { newContent } = detectCorrection(message);
    const mode = /方針変えた|やめた/.test(message) ? 'SUPERSEDED' : 'CORRECTED';

    if (!newContent) {
      await this.memoryService.invalidate(targetId, now, message.slice(0, 80));
      return {
        response: {
          text: [
            `「${target.statement}」を${mode === 'SUPERSEDED' ? '方針変更' : '訂正'}として記録しました（旧情報は履歴として保持します）。`,
            '現在の正しい情報を教えていただければ、新しい記憶として登録します。'
          ].join('\n'),
          dataStatus,
          uiHint: 'text',
          confidence: 'HIGH',
          evidence: [],
          toolsUsed: ['memory_correct']
        },
        intent: 'memory_recall',
        memoryIds: [targetId]
      };
    }

    const { replacement } = await this.memoryService.correct(
      targetId,
      {
        type: target.type,
        statement: newContent,
        entities: target.entities,
        relations: [],
        layer: target.layer,
        sensitivity: 'NORMAL',
        companyId: target.companyId,
        projectId: target.projectId,
        source: 'CONVERSATION',
        sourceId: context.sessionId,
        sourceTimestamp: now,
        validFrom: now.slice(0, 10),
        confidence: 'HIGH',
        createdBy: `user:${principal.label}`,
        reviewStatus: 'CONFIRMED_BY_USER',
        evidence: [
          {
            label: '訂正発言',
            value: message.slice(0, 120),
            source: `会話（${principal.label}）`,
            asOf: now
          }
        ]
      },
      now,
      message.slice(0, 80),
      mode
    );
    // Correction Impact: 修正で影響する案件・見積・指標・記憶を探索して報告する
    const allMemories = await this.repository.getMemories();
    const impact = analyzeCorrectionImpact(ctx.dataset, target, newContent, allMemories);
    const impactLines = formatImpactReport(impact);
    return {
      response: {
        text: [
          '記憶を更新しました（履歴は保持しています）。',
          `旧: ${target.statement}（${mode}）`,
          `新: ${replacement.statement}（${replacement.validFrom}〜 / ACTIVE）`,
          ...(impactLines.length > 0 ? ['', ...impactLines] : [])
        ].join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence: 'HIGH',
        evidence: replacement.evidence,
        toolsUsed: ['memory_correct']
      },
      intent: 'memory_recall',
      memoryIds: [replacement.memoryId]
    };
  }

  private async handleMemoryRecall(
    ctx: ToolContext,
    message: string,
    context: ConversationContext,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    // 「いつ変更した？」「なぜ変えた？」→ 変遷履歴で答える
    if (/いつ変更|なぜ変えた|変更の経緯/.test(message) && context.lastMemoryIds[0]) {
      const chain = await this.memoryService.history(context.lastMemoryIds[0]);
      if (chain.length > 1) {
        const lines = [
          '変遷履歴:',
          ...chain.map(
            (m) =>
              `・${m.validFrom}〜${m.validUntil ?? '現在'}: ${m.statement}（${m.status}${m.correctionNote ? ` / 理由: ${m.correctionNote}` : ''}）`
          )
        ];
        return {
          response: {
            text: lines.join('\n'),
            dataStatus,
            uiHint: 'text',
            confidence: 'HIGH',
            evidence: chain.flatMap((m) => m.evidence).slice(0, 6),
            toolsUsed: ['memory_history']
          },
          intent: 'memory_recall',
          memoryIds: chain.map((m) => m.memoryId)
        };
      }
    }

    const yearMatch = message.match(/(20\d{2})年(当時|時点|の頃|は)/);
    const validAt = yearMatch ? `${yearMatch[1]}-07-01` : undefined;
    const q = message
      .replace(
        /前に|以前|昨日の話|この間|何だっけ|何て言ってた|言ってた|覚えてる|覚えている|どうなった|について|の件|[？?]/g,
        ' '
      )
      .replace(/(20\d{2})年(当時|時点|の頃|は)/, ' ')
      .trim();
    const results = await this.memoryService.search(
      {
        q: q.length >= 2 ? q : undefined,
        validAt,
        includeInactive: Boolean(validAt),
        companyId: ctx.scope !== 'group' ? ctx.scope : undefined,
        limit: 5
      },
      principal
    );
    if (results.length === 0) {
      return this.simpleText(
        [
          '該当する記憶が見つかりませんでした。推測では補いません。',
          '（記憶されるのは会話で確認された事実・判断・課題などです。対象や時期を変えて聞き直すこともできます）'
        ].join('\n'),
        'memory_recall',
        'UNKNOWN',
        dataStatus
      );
    }
    const lines = [
      validAt ? `【${yearMatch?.[1]}年時点で有効だった記憶】` : '【関連する記憶】',
      ...results.map(
        (m) =>
          `・[${m.type}] ${m.statement}（${m.validFrom}〜${m.validUntil ?? '現在'} / ${m.status}${m.reviewStatus === 'PENDING_REVIEW' ? ' / 確認待ち' : ''} / 出典: ${m.source}）`
      ),
      '',
      '「それどこから？」で出典、「それ、今も正しい？」で有効性、「それ違う」で訂正できます。'
    ];
    const confidence = results.some((m) => ['CONFIRMED', 'HIGH'].includes(m.confidence))
      ? 'HIGH'
      : 'MEDIUM';
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence,
        evidence: results.flatMap((m) => m.evidence).slice(0, 8),
        toolsUsed: ['memory_search']
      },
      intent: 'memory_recall',
      memoryIds: results.map((m) => m.memoryId)
    };
  }

  private async handleDecisionReview(
    ctx: ToolContext,
    context: ConversationContext,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const memories = await this.repository.getMemories();
    const target = memories.find((m) => m.memoryId === context.lastMemoryIds[0]);
    if (!target) {
      return this.simpleText(
        '対象の記憶を特定できませんでした。',
        'decision_review',
        'UNKNOWN',
        dataStatus
      );
    }
    const today = jstDate(ctx.dataset.asOf);
    const lines: string[] = [`「${target.statement}」の現在の状態:`];
    if (target.status === 'ACTIVE' && (!target.validUntil || target.validUntil >= today)) {
      lines.push(
        `・ACTIVE（有効）です。有効期限: ${target.validUntil ?? '設定なし'} / 確信度: ${target.confidence}${target.reviewStatus === 'PENDING_REVIEW' ? ' / ただし正式確認待ちです' : ''}`
      );
    } else if (target.supersededBy) {
      const successor = memories.find((m) => m.memoryId === target.supersededBy);
      lines.push(
        `・${target.status}: 置き換えられています。現在有効: 「${successor?.statement ?? '不明'}」`
      );
    } else {
      lines.push(
        `・${target.status}: 有効期限（${target.validUntil ?? '不明'}）を過ぎているか訂正済みです。再評価を推奨します。`
      );
    }
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence: 'HIGH',
        evidence: target.evidence.slice(0, 4),
        toolsUsed: ['memory_search']
      },
      intent: 'decision_review',
      memoryIds: [target.memoryId]
    };
  }

  /** 「今日何を覚えた？」— Daily Learning Summary（Phase B1 §13-§14） */
  private async handleLearnedToday(
    ctx: ToolContext,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const today = jstDate(ctx.dataset.asOf);
    const all = await this.memoryService.search({ includeInactive: true, limit: 300 }, principal);
    const todays = all.filter((m) => jstDate(m.createdAt) === today);
    if (todays.length === 0) {
      return this.simpleText(
        '今日はまだ新しく覚えたことはありません。会話の中の事実・判断・課題を記憶していきます。',
        'memory_audit',
        'HIGH',
        dataStatus
      );
    }
    const active = todays.filter((m) => m.status === 'ACTIVE' && m.reviewStatus !== 'PENDING_REVIEW');
    const pending = todays.filter((m) => m.status === 'ACTIVE' && m.reviewStatus === 'PENDING_REVIEW');
    const retired = todays.filter((m) => m.status !== 'ACTIVE');
    const lines = [
      `【今日の学習サマリー】（${today}）`,
      `今日は${todays.length}件を記憶しました。`,
      ...(active.length > 0
        ? ['', '覚えたこと:', ...active.slice(0, 8).map((m) => `・[${m.type}] ${m.statement}`)]
        : []),
      ...(pending.length > 0
        ? [
            '',
            '確認待ち（正式方針はAIが独断で確定しません）:',
            ...pending.slice(0, 5).map((m) => `・${m.statement} — 「正式方針にする」で確定できます`)
          ]
        : []),
      ...(retired.length > 0
        ? ['', `訂正・取消: ${retired.length}件（履歴として保持しています）`]
        : []),
      '',
      '「それ違う」で訂正、「今のなし」で取り消しできます。'
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence: 'HIGH',
        evidence: [],
        toolsUsed: ['memory_search']
      },
      intent: 'memory_audit',
      memoryIds: [...pending, ...active].slice(0, 5).map((m) => m.memoryId)
    };
  }

  private async handleMemoryAudit(
    ctx: ToolContext,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const results = await this.memoryService.search(
      { includeInactive: false, limit: 100 },
      principal
    );
    if (results.length === 0) {
      return this.simpleText(
        'まだ有効な記憶はありません。会話の中の事実・判断・課題を少しずつ記憶していきます。',
        'memory_audit',
        'HIGH',
        dataStatus
      );
    }
    const byType = new Map<string, number>();
    for (const m of results) byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
    const lines = [
      `現在、あなたの権限で参照できる有効な記憶は${results.length}件です。`,
      ...[...byType.entries()].map(([type, count]) => `・${type}: ${count}件`),
      '',
      '直近の記憶:',
      ...results.slice(0, 5).map((m) => `・[${m.type}] ${m.statement}`),
      '',
      '「それ違う」で訂正、「それどこから？」で出典を確認できます（記憶はブラックボックスにしません）。'
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence: 'HIGH',
        evidence: [],
        toolsUsed: ['memory_search']
      },
      intent: 'memory_audit',
      memoryIds: results.slice(0, 5).map((m) => m.memoryId)
    };
  }

  private async handleInnovation(
    ctx: ToolContext,
    message: string,
    principal: Principal,
    dataStatus: DataStatus,
    mode: { bold?: boolean; firstPrinciples?: boolean } = {}
  ): Promise<HandlerResult> {
    const related = await this.memoryService.search(
      { q: message, includeInactive: false, limit: 5 },
      principal
    );
    const preferences = await this.memoryService.search(
      { type: 'PREFERENCE', limit: 5 },
      principal
    );
    const concise =
      /簡潔|短く|要点だけ/.test(message) || preferences.some((m) => /簡潔|短く/.test(m.statement));
    const proposal = buildInnovationProposal(
      ctx.dataset,
      ctx.scope,
      message,
      related,
      concise,
      mode
    );
    return {
      response: {
        text: formatInnovationProposal(proposal, concise),
        dataStatus,
        uiHint: 'text',
        data: proposal,
        confidence: 'MEDIUM',
        evidence: [],
        toolsUsed: ['innovation_engine', 'memory_search']
      },
      intent: 'ideation',
      proposal: { problem: message }
    };
  }

  private async handleGeneral(
    ctx: ToolContext,
    message: string,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const categories = classifyConversation(message);
    // 社内事実として渡してよいのはTool/Memory由来のみ（LLMに捏造させない）
    const facts: string[] = [];
    for (const entity of extractEntities(ctx.dataset, message)) {
      if (entity.entityType === 'Project' && entity.entityId) {
        const project = ctx.dataset.projects.find((p) => p.projectId === entity.entityId);
        if (project) {
          facts.push(
            `案件「${project.name}」: ステージ${project.stage}、受注額${yen(project.orderAmount)}`
          );
        }
      }
    }
    const memories = await this.memoryService.search({ q: message, limit: 3 }, principal);
    facts.push(...memories.map((m) => `記憶[${m.type}] ${m.statement}`));

    const answer = await this.reasoner.answer(message, facts);
    return {
      response: {
        text: answer.available
          ? answer.text
          : [
              `${answer.text}`,
              '',
              `（分類: ${categories.join(' + ')} / 推測では回答しません）`
            ].join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence: answer.available ? 'MEDIUM' : 'UNKNOWN',
        evidence: [],
        toolsUsed: answer.available ? ['general_reasoning'] : []
      },
      intent: 'general',
      memoryIds: memories.length > 0 ? memories.map((m) => m.memoryId) : undefined
    };
  }

  // ------------------------------------------------------------------
  // Phase N: Multi-Agent Plan / Critic / Impact / 会話操作
  // ------------------------------------------------------------------

  private async handlePlan(
    ctx: ToolContext,
    message: string,
    plan: NonNullable<ReturnType<typeof buildPlan>>,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    // §30: 内部Role名はユーザーへ露出しない自然な前置き
    const preferences = await this.memoryService.search(
      { type: 'PREFERENCE', limit: 5 },
      principal
    );
    const concise =
      /簡潔|短く|要点だけ/.test(message) || preferences.some((m) => /簡潔|短く/.test(m.statement));
    const outcome = await this.executor.execute(plan, ctx, principal, concise);
    const intro = '確認しました。社内データ・過去の判断・資金面を見ています。';
    return {
      response: {
        text: `${intro}\n\n${outcome.synthesisText}`,
        dataStatus,
        uiHint: 'text',
        data: {
          planId: plan.planId,
          budget: plan.budget,
          taskCount: plan.tasks.length,
          criticIssues: outcome.criticIssues,
          trace: this.traceLog.forPlan(plan.planId)
        },
        confidence: 'MEDIUM',
        evidence: outcome.evidence,
        toolsUsed: ['agent_plan']
      },
      intent: 'plan'
    };
  }

  private async handleRememberThis(
    ctx: ToolContext,
    message: string,
    context: ConversationContext,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const explicit = message.replace(/それ|これ|を?覚えておいて|覚えといて|。/g, '').trim();
    const statement =
      explicit.length >= 4 ? explicit : context.lastText.split('\n')[0]?.slice(0, 120);
    if (!statement) {
      return this.simpleText(
        '覚える内容を特定できませんでした。内容を添えて指示してください。',
        'memory_recall',
        'UNKNOWN',
        dataStatus
      );
    }
    try {
      const saved = await this.memoryService.save(
        {
          type: 'CONTEXT',
          statement,
          entities: extractEntities(ctx.dataset, statement),
          relations: [],
          layer: 'PRESIDENT',
          sensitivity: 'NORMAL',
          companyId:
            ctx.scope === 'group' ? (ctx.dataset.companies[0]?.companyId ?? 'group') : ctx.scope,
          source: 'CONVERSATION',
          sourceId: context.sessionId,
          sourceTimestamp: ctx.dataset.asOf,
          validFrom: ctx.dataset.asOf.slice(0, 10),
          confidence: 'HIGH',
          createdBy: `user:${principal.label}`,
          reviewStatus: 'CONFIRMED_BY_USER',
          evidence: [
            {
              label: '指示',
              value: message.slice(0, 120),
              source: `会話（${principal.label}）`,
              asOf: ctx.dataset.asOf
            }
          ]
        },
        ctx.dataset.asOf
      );
      return {
        response: {
          text: `覚えました: 「${saved.record.statement}」`,
          dataStatus,
          uiHint: 'text',
          confidence: 'HIGH',
          evidence: [],
          toolsUsed: ['memory_save']
        },
        intent: 'memory_recall',
        memoryIds: [saved.record.memoryId]
      };
    } catch (error) {
      return this.simpleText(
        `この内容は記憶できません: ${error instanceof Error ? error.message : String(error)}`,
        'memory_recall',
        'UNKNOWN',
        dataStatus
      );
    }
  }

  private async handleUndoMemory(
    ctx: ToolContext,
    context: ConversationContext,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const targetId = context.lastMemoryIds[0];
    try {
      const archived = await this.memoryService.archive(targetId, ctx.dataset.asOf);
      return {
        response: {
          text: `取り消しました（「${archived.statement}」をARCHIVED。履歴は保持しています）。`,
          dataStatus,
          uiHint: 'text',
          confidence: 'HIGH',
          evidence: [],
          toolsUsed: ['memory_archive']
        },
        intent: 'memory_recall',
        memoryIds: []
      };
    } catch {
      return this.simpleText(
        '取り消す対象の記憶を特定できませんでした。',
        'memory_recall',
        'UNKNOWN',
        dataStatus
      );
    }
  }

  private async handlePromoteDecision(
    ctx: ToolContext,
    context: ConversationContext,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    if (!canRequestWrite(principal) || !['PRESIDENT', 'EXECUTIVE'].includes(principal.role)) {
      return this.simpleText(
        `ロール${principal.role}は正式方針の確定ができません。`,
        'decision_review',
        'UNKNOWN',
        dataStatus
      );
    }
    const memories = await this.repository.getMemories();
    const target = memories.find((m) => m.memoryId === context.lastMemoryIds[0]);
    if (!target) {
      return this.simpleText(
        '正式化する対象の記憶を特定できませんでした。',
        'decision_review',
        'UNKNOWN',
        dataStatus
      );
    }
    target.type = 'DECISION';
    target.reviewStatus = 'CONFIRMED_BY_USER';
    target.confidence = 'CONFIRMED';
    target.layer = 'PRESIDENT';
    target.updatedAt = ctx.dataset.asOf;
    await this.repository.saveMemory(target);
    const impact = analyzeCorrectionImpact(ctx.dataset, target, null, memories);
    const impactLines = formatImpactReport(impact);
    return {
      response: {
        text: [
          `正式方針として確定しました: 「${target.statement}」（DECISION / CONFIRMED）`,
          ...(impactLines.length > 0 ? ['', ...impactLines] : [])
        ].join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence: 'HIGH',
        evidence: target.evidence.slice(0, 3),
        toolsUsed: ['memory_confirm']
      },
      intent: 'decision_review',
      memoryIds: [target.memoryId]
    };
  }

  private async handleImpactQuery(
    ctx: ToolContext,
    context: ConversationContext,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const memories = await this.repository.getMemories();
    const target = memories.find((m) => m.memoryId === context.lastMemoryIds[0]);
    if (!target) {
      return this.simpleText(
        '影響範囲を調べる対象を特定できませんでした。',
        'memory_recall',
        'UNKNOWN',
        dataStatus
      );
    }
    const impact = analyzeCorrectionImpact(ctx.dataset, target, null, memories);
    const lines = formatImpactReport(impact);
    return {
      response: {
        text:
          lines.length > 0
            ? [`「${target.statement}」の影響範囲:`, ...lines].join('\n')
            : `「${target.statement}」について、現在のデータで直接影響する案件・見積は見つかりませんでした。`,
        dataStatus,
        uiHint: 'text',
        data: impact,
        confidence: 'MEDIUM',
        evidence: [],
        toolsUsed: ['impact_analysis']
      },
      intent: 'memory_recall',
      memoryIds: context.lastMemoryIds
    };
  }

  private async handleProposalRisk(
    ctx: ToolContext,
    context: ConversationContext,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const review = await reviewAnswerWithAdvisor(
      {
        text: context.lastText,
        evidence: context.lastEvidence,
        confidence: context.lastConfidence
      },
      await this.memoryService.search(
        { type: 'DECISION', limit: 5 },
        { role: 'PRESIDENT', companyIds: [], label: 'critic' }
      ),
      this.options.criticAdvisor
    );
    const lines = [
      '直前の案のリスク:',
      '・実行体制: 例外対応の設計が甘いと現場負荷が増える',
      '・検知精度: 過検知が続くと通知が無視される',
      '・移行期: 旧運用との二重管理が発生する',
      ...(review.issues.length > 0 ? review.issues.map((i) => `・検証指摘: ${i.issue}`) : []),
      '',
      '対策: 最小テストで一致率・工数を測ってから拡大してください。'
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'text',
        confidence: 'MEDIUM',
        evidence: [],
        toolsUsed: ['critic']
      },
      intent: 'critic'
    };
  }

  private async handleDevilsAdvocate(
    ctx: ToolContext,
    context: ConversationContext,
    principal: Principal,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    if (!context.lastText) {
      return this.simpleText('検証する直前の回答がありません。', 'critic', 'UNKNOWN', dataStatus);
    }
    const decisions = await this.memoryService.search({ type: 'DECISION', limit: 5 }, principal);
    const review = await reviewAnswerWithAdvisor(
      {
        text: context.lastText,
        evidence: context.lastEvidence,
        confidence: context.lastConfidence
      },
      decisions,
      this.options.criticAdvisor
    );
    const counters = devilsAdvocate(context.lastText.slice(0, 60), context.lastText.split('\n'));
    const lines = [
      '【反対側からの検証（Devil’s Advocate）】',
      ...counters.map((c) => `・${c}`),
      '',
      review.issues.length > 0
        ? `【検証で見つかった指摘 ${review.issues.length}件】`
        : '【検証指摘】重大な問題は検出されませんでした（根拠と確信度は直前回答のとおり）',
      ...review.issues.map((i) => `・[${i.severity}] ${i.issue} → ${i.recommendation}`),
      '',
      '※検証は回答を書き換えません。判断材料としてご利用ください。'
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'text',
        data: review,
        confidence: 'MEDIUM',
        evidence: [],
        toolsUsed: ['critic']
      },
      intent: 'critic'
    };
  }

  private async handleExperimentStatus(
    ctx: ToolContext,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    const experiments = await this.repository.getExperiments();
    if (experiments.length === 0) {
      return this.simpleText(
        '登録されている実験はありません。改善案を「実験として登録」すると結果まで追跡します。',
        'general',
        'UNKNOWN',
        dataStatus
      );
    }
    const lines = [
      `実験ポートフォリオ（${experiments.length}件）:`,
      ...experiments
        .slice(-5)
        .map(
          (e) =>
            `・${e.hypothesis}（${e.metric}: ${e.baseline} → ${e.result ?? e.current ?? '計測中'} / ${e.status}${e.evaluation ? ` / ${e.evaluation}` : ''}）`
        )
    ];
    return {
      response: {
        text: lines.join('\n'),
        dataStatus,
        uiHint: 'text',
        data: { experiments },
        confidence: 'HIGH',
        evidence: [],
        toolsUsed: ['experiments']
      },
      intent: 'general'
    };
  }

  private async handleUnknown(
    ctx: ToolContext,
    message: string,
    dataStatus: DataStatus
  ): Promise<HandlerResult> {
    void ctx;
    return this.simpleText(
      [
        message
          ? `「${message}」に確定データで答えられる情報が見つかりませんでした。推測では回答しません。`
          : '対象を特定できませんでした。',
        '',
        '次のような質問に答えられます:',
        '・今月どう？ / 売上から / 現金大丈夫？ / 来月仕事足りる？',
        '・危ない現場は？ / A案件なぜ利益悪い？ / 請求漏れてない？',
        '・今日何をすべき？ / ○○さんの案件どう？ / この会社調べて'
      ].join('\n'),
      'unknown',
      'UNKNOWN',
      dataStatus
    );
  }

  // ------------------------------------------------------------------

  private remember(context: ConversationContext, scope: CompanyScope, result: HandlerResult): void {
    context.scope = scope;
    context.lastIntent = result.intent;
    if (result.projectId !== undefined) context.lastProjectId = result.projectId;
    if (result.customerId !== undefined) context.lastCustomerId = result.customerId;
    if (result.listItems) {
      context.lastListItems = result.listItems;
      context.lastListShown = result.listShown ?? result.listItems.length;
    }
    if (result.draft !== undefined) context.lastDraft = result.draft;
    if (result.memoryIds) context.lastMemoryIds = result.memoryIds;
    if (result.proposal !== undefined) context.lastProposal = result.proposal;
    context.lastText = result.response.text.slice(0, 600);
    context.lastEvidence = result.response.evidence;
    context.lastConfidence = result.response.confidence;
    this.contexts.save(context);
  }
}

export { scopeLabel };
