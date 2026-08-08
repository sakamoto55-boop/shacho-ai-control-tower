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
import { ContextStore, type ConversationContext, type IntentKey } from './context.js';

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
}

interface ExecutionState {
  toolCalls: number;
  steps: number;
  startedAtMs: number;
}

export class CommandOrchestrator {
  private readonly contexts = new ContextStore();

  constructor(private readonly repository: CommandRepository) {}

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
    this.remember(context, scope, result);
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

    // --- Write系（下書き→承認） ---
    if (/送って|送信して/.test(message))
      return this.handleSendRequest(ctx, message, context, principal, dataStatus);
    if (/連絡文|連絡案|文面.{0,4}(作|お願い)|どう(連絡|返)/.test(message)) {
      return this.handleDraft(ctx, message, context, principal, dataStatus);
    }
    if (
      /(調べて|調査して|使える？|使えますか)/.test(message) &&
      /(会社|制度|法律|法令|補助金|競合|市場|業界|相場|自治体)/.test(message)
    ) {
      return this.handleResearch(ctx, message, principal, dataStatus);
    }
    if (/どう思う|この判断/.test(message))
      return this.handleAdvice(ctx, message, context, dataStatus);

    // --- Read系 ---
    if (/おはよう|ブリーフ|朝の報告|今日の報告/i.test(message))
      return this.runIntent('brief', ctx, dataStatus);
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
    if (/現金|資金|キャッシュ/.test(message)) return this.runIntent('cash', ctx, dataStatus);

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

    return this.handleUnknown(ctx, message, dataStatus);
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
    if (/なぜ(利益|粗利|落ち|悪)|^なぜ？?$/.test(message) && contextProject) {
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
    if (/どうすれば|対策(は|ある)|どうしたら/.test(message)) {
      return this.handleAdvice(ctx, message, context, dataStatus);
    }

    // 「もっと詳しく」
    if (/もっと詳しく|詳細(を|は)?/.test(message) && context.lastIntent) {
      if (contextProject) return this.handleMarginWhy(ctx, contextProject, dataStatus);
      if (context.lastIntent === 'cash') return this.handleCashDetail(ctx, dataStatus);
      if (context.lastIntent === 'sales') return this.runIntent('pipeline', ctx, dataStatus);
      return this.runIntent(context.lastIntent, ctx, dataStatus, context.lastProjectId);
    }

    // 「根拠は？」
    if (/根拠(は|を|ある)/.test(message)) {
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
    const brief = generateExecutiveBrief(ctx.dataset, ctx.scope, ctx.store.decisions);
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
    context.lastEvidence = result.response.evidence;
    context.lastConfidence = result.response.confidence;
    this.contexts.save(context);
  }
}

export { scopeLabel };
