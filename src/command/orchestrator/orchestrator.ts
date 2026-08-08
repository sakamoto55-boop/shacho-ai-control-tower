/**
 * Orchestrator。会話をシステムの中心に置くための中核。
 *
 * 基本構造は「Orchestrator → 必要なTool/専門処理」であり、
 * 常時マルチエージェントを乱立させない。質問を意図に振り分け、
 * 決定論エンジン（Read Tool）を実行し、事実と推測を分離した
 * 根拠付き回答（CommandChatResponse）を組み立てる。
 *
 * 回答の優先順位: LEVEL1 確定データ → LEVEL2 計算結果 → LEVEL3 確認済み社内文書
 * → LEVEL4 経営判断履歴 → LEVEL5 外部一次情報 → LEVEL6 AI分析・仮説。
 * データがない場合は推測で埋めず「分からない」を正しく返す。
 */
import type {
  CashScenarioAdjustment,
  CommandChatRequest,
  CommandChatResponse,
  CompanyScope,
  Customer,
  Project
} from '../domain/types.js';
import { filterDatasetByScope, scopeLabel } from '../domain/scope.js';
import type { CommandDataset } from '../data/seed.js';
import type { CommandRepository } from '../repositories/CommandRepository.js';
import { computeCashForecast, horizonBalance } from '../engines/cashForecast.js';
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

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function findProject(dataset: CommandDataset, message: string): Project | undefined {
  // 「A案件」「C案件どう？」のような短い呼び名でも当たるよう、名称の前方一致トークンで探す
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

export class CommandOrchestrator {
  constructor(private readonly repository: CommandRepository) {}

  async chat(request: CommandChatRequest): Promise<CommandChatResponse> {
    const asOf = request.asOf ?? new Date().toISOString();
    const scope: CompanyScope = request.scope ?? 'group';
    const dataset = await this.repository.getDataset(asOf);
    const store = await this.repository.getStore();
    const ctx: ToolContext = { dataset, store, repository: this.repository, scope };
    const message = request.message.trim();

    // --- Write系（下書き→承認）は先に判定する ---
    if (/送って|送信して/.test(message)) return this.handleSendRequest(ctx, message);
    if (
      /(調べて|調査して)/.test(message) &&
      /(会社|制度|法律|法令|競合|市場|業界|相場)/.test(message)
    ) {
      return this.handleResearch(ctx, message);
    }

    // --- Read系 ---
    if (/おはよう|ブリーフ|朝の報告|今日の報告/i.test(message)) return this.handleBrief(ctx);
    if (/遅れたら|買ったら|購入したら|使ったら/.test(message))
      return this.handleCashScenario(ctx, message);
    if (/最終接点|最後の(連絡|接点)|いつ(連絡|会っ)/.test(message))
      return this.handleLastContact(ctx, message);
    if (/請求.{0,4}(漏|も)れ|未請求|未入金|入金.{0,4}(遅|超過)/.test(message))
      return this.handleInvoices(ctx);
    if (/危ない|やばい|まずい|リスク.{0,4}(案件|現場)|悪い現場/.test(message))
      return this.handleRiskyProjects(ctx);
    if (/今日.{0,6}(やる|すべき|何)|やること|要対応/.test(message)) return this.handleToday(ctx);
    if (/来月|仕事.{0,4}足り|パイプライン|見込み案件/.test(message))
      return this.handlePipeline(ctx);
    if (/現金|資金|キャッシュ/.test(message)) return this.handleCash(ctx);

    const project = findProject(dataset, message);
    if (project && /なぜ|why|利益|粗利|原価/.test(message))
      return this.handleMarginWhy(ctx, project);
    if (project) return this.handleProjectCard(ctx, project);

    const employee = filterDatasetByScope(dataset, scope).employees.find((item) =>
      message.includes(item.name)
    );
    if (employee) return this.handleEmployeeProjects(ctx, employee.employeeId, employee.name);

    if (/売上|今月どう|着地|目標/.test(message)) return this.handleSales(ctx);

    return this.handleUnknown(ctx, message);
  }

  private async handleBrief(ctx: ToolContext): Promise<CommandChatResponse> {
    const brief = generateExecutiveBrief(ctx.dataset, ctx.scope, ctx.store.decisions);
    return {
      text: brief.text,
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
    };
  }

  private async handleSales(ctx: ToolContext): Promise<CommandChatResponse> {
    const sales = computeSalesSummary(ctx.dataset, ctx.scope);
    const lines = [
      '【確認できた事実】',
      `${sales.month}の確定売上は${yen(sales.confirmedSales)}、着地予測は${yen(sales.landingForecast)}です。`
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
      text: lines.join('\n'),
      uiHint: 'chart',
      data: sales,
      confidence: 'HIGH',
      evidence: sales.evidence,
      toolsUsed: ['get_sales_summary', 'get_pipeline']
    };
  }

  private async handleCash(ctx: ToolContext): Promise<CommandChatResponse> {
    const cash = computeCashForecast(ctx.dataset, ctx.scope);
    const staleNote = cash.freshness.stale
      ? `（注意: 残高は${cash.freshness.source}のもので最新ではありません）`
      : '';
    const text = [
      '【確認できた事実】',
      `現預金は${yen(cash.currentBalance)}です${staleNote}。`,
      `予測残高: 7日後${yen(horizonBalance(cash, 7))} / 30日後${yen(horizonBalance(cash, 30))} / 60日後${yen(horizonBalance(cash, 60))} / 90日後${yen(horizonBalance(cash, 90))}`,
      `期間中の最低残高は${cash.minBalance.date}の${yen(cash.minBalance.balance)}です。`,
      '',
      '計算は「現在現預金＋入金予定－支払予定」の決定論ロジックで、確定と予測を区別しています。',
      '「A社の入金が10日遅れたら？」のようなシナリオも再計算できます。'
    ].join('\n');
    return {
      text,
      uiHint: 'cash_table',
      data: cash,
      confidence: cash.freshness.stale ? 'MEDIUM' : 'HIGH',
      evidence: cash.evidence,
      toolsUsed: ['get_cash_position', 'get_cash_forecast']
    };
  }

  private async handleCashScenario(
    ctx: ToolContext,
    message: string
  ): Promise<CommandChatResponse> {
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
      return {
        text: 'シナリオ条件を特定できませんでした。「○○の入金が10日遅れたら？」「来月500万円の車両を買ったら？」のように金額または日数を含めてください。',
        uiHint: 'text',
        confidence: 'UNKNOWN',
        evidence: [],
        toolsUsed: []
      };
    }

    const base = computeCashForecast(ctx.dataset, ctx.scope);
    const scenario = computeCashForecast(ctx.dataset, ctx.scope, adjustments);
    const text = [
      `【計算結果】${notes.join('、')}:`,
      `30日後残高 ${yen(horizonBalance(base, 30))} → ${yen(horizonBalance(scenario, 30))}`,
      `60日後残高 ${yen(horizonBalance(base, 60))} → ${yen(horizonBalance(scenario, 60))}`,
      `期間中最低残高 ${yen(base.minBalance.balance)}（${base.minBalance.date}） → ${yen(scenario.minBalance.balance)}（${scenario.minBalance.date}）`,
      '',
      scenario.minBalance.balance < 0
        ? '【AIの推測】この条件では資金ショートの恐れがあります。入金前倒しか支払時期の調整を検討してください。'
        : '【AIの推測】この条件でも残高はプラス圏ですが、他の支払遅延が重なる場合は再確認が必要です。'
    ].join('\n');
    return {
      text,
      uiHint: 'cash_table',
      data: { base, scenario, adjustments },
      confidence: 'MEDIUM',
      evidence: scenario.evidence,
      toolsUsed: ['get_cash_forecast']
    };
  }

  private async handleRiskyProjects(ctx: ToolContext): Promise<CommandChatResponse> {
    const deteriorations = findMarginDeteriorations(ctx.dataset, ctx.scope);
    const alerts = activeAlerts(buildAlerts(ctx.dataset, ctx.scope, ctx.store.decisions));
    if (deteriorations.length === 0) {
      return {
        text: '【確認できた事実】現在、予定粗利から大きく悪化している進行中案件はありません。',
        uiHint: 'text',
        confidence: 'HIGH',
        evidence: [],
        toolsUsed: ['get_alerts']
      };
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
      text: lines.join('\n'),
      uiHint: 'ranking',
      data: { deteriorations, alerts: alerts.filter((alert) => alert.kind === 'margin_drop') },
      confidence: 'HIGH',
      evidence: deteriorations.flatMap((item) => item.margin.evidence).slice(0, 10),
      toolsUsed: ['get_project_margin', 'get_alerts']
    };
  }

  private async handleMarginWhy(ctx: ToolContext, project: Project): Promise<CommandChatResponse> {
    const margin = computeProjectMargin(ctx.dataset, project);
    if (margin.forecastMarginRate === null) {
      return {
        text: `【確認できた事実】${project.name}には原価データが登録されておらず、粗利は算出できません。`,
        uiHint: 'project_card',
        data: margin,
        confidence: 'UNKNOWN',
        evidence: margin.evidence,
        toolsUsed: ['get_project_margin']
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
      text: lines.join('\n'),
      uiHint: 'project_card',
      data: margin,
      confidence: 'HIGH',
      evidence: margin.evidence,
      toolsUsed: ['get_project_margin']
    };
  }

  private async handleProjectCard(
    ctx: ToolContext,
    project: Project
  ): Promise<CommandChatResponse> {
    const margin = computeProjectMargin(ctx.dataset, project);
    const scoped = filterDatasetByScope(ctx.dataset, ctx.scope);
    const customer = scoped.customers.find((item) => item.customerId === project.customerId);
    const lines = [
      '【確認できた事実】',
      `${project.name}（${customer?.name ?? '顧客不明'}）: ステージ ${project.stage}、受注額${yen(project.orderAmount)}。`,
      margin.forecastMarginRate !== null
        ? `予測粗利率${pct(margin.forecastMarginRate)}（予定${pct(margin.plannedMarginRate)}）。`
        : '原価データ未登録のため粗利は算出できません。',
      project.dueDate ? `完工予定 ${project.dueDate}。` : ''
    ].filter(Boolean);
    return {
      text: lines.join('\n'),
      uiHint: 'project_card',
      data: { project, margin, customer },
      confidence: margin.forecastMarginRate !== null ? 'HIGH' : 'MEDIUM',
      evidence: margin.evidence,
      toolsUsed: ['get_project_margin']
    };
  }

  private async handleEmployeeProjects(
    ctx: ToolContext,
    employeeId: string,
    name: string
  ): Promise<CommandChatResponse> {
    const scoped = filterDatasetByScope(ctx.dataset, ctx.scope);
    const projects = scoped.projects.filter((project) => project.ownerEmployeeId === employeeId);
    const interactions = scoped.interactions.filter(
      (interaction) => interaction.employeeId === employeeId
    );
    if (projects.length === 0 && interactions.length === 0) {
      return {
        text: `【確認できた事実】${name}さんが担当として登録されている案件・接点記録は現在のデータにありません。担当者情報が未入力の可能性があります。`,
        uiHint: 'text',
        confidence: 'UNKNOWN',
        evidence: [],
        toolsUsed: ['get_interactions']
      };
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
      text: lines.join('\n'),
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
    };
  }

  private async handleInvoices(ctx: ToolContext): Promise<CommandChatResponse> {
    const result = checkInvoices(ctx.dataset, ctx.scope);
    if (result.issues.length === 0) {
      return {
        text: '【確認できた事実】完工未請求・期日超過・金額不一致は検出されませんでした。',
        uiHint: 'text',
        confidence: 'HIGH',
        evidence: [],
        toolsUsed: ['get_invoice_status']
      };
    }
    const lines = [
      `【確認できた事実】請求・入金の要確認が${result.issues.length}件あります。`,
      ...result.issues.map((issue, i) => `${i + 1}. ${issue.title} — ${issue.detail}`)
    ];
    return {
      text: lines.join('\n'),
      uiHint: 'ranking',
      data: result,
      confidence: 'HIGH',
      evidence: result.issues.flatMap((issue) => issue.evidence),
      toolsUsed: ['get_invoice_status']
    };
  }

  private async handleToday(ctx: ToolContext): Promise<CommandChatResponse> {
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
      text: lines.join('\n'),
      uiHint: 'tasks',
      data: { alerts: urgent, leaks, approvalsWaiting: waiting },
      confidence: 'HIGH',
      evidence: [
        ...urgent.flatMap((alert) => alert.evidence),
        ...leaks.flatMap((leak) => leak.evidence)
      ].slice(0, 10),
      toolsUsed: ['get_alerts', 'get_sales_leaks']
    };
  }

  private async handlePipeline(ctx: ToolContext): Promise<CommandChatResponse> {
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
      text: lines.join('\n'),
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
    };
  }

  private async handleLastContact(ctx: ToolContext, message: string): Promise<CommandChatResponse> {
    const customer = findCustomer(ctx.dataset, message);
    if (!customer) {
      return {
        text: '【確認できた事実】該当する顧客を特定できませんでした。顧客名を含めて質問してください。',
        uiHint: 'text',
        confidence: 'UNKNOWN',
        evidence: [],
        toolsUsed: ['get_interactions']
      };
    }
    const interactions = ctx.dataset.interactions
      .filter((interaction) => interaction.customerId === customer.customerId)
      .sort((a, b) => b.datetime.localeCompare(a.datetime));
    if (interactions.length === 0) {
      return {
        text: `【確認できた事実】${customer.name}との接点記録は現在のデータにありません。電話・一部チャット履歴は構造化されていないため、接点がなかったとは断定できません。`,
        uiHint: 'text',
        confidence: 'UNKNOWN',
        evidence: [],
        toolsUsed: ['get_interactions']
      };
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
      text: lines.join('\n'),
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
    };
  }

  private async handleResearch(ctx: ToolContext, message: string): Promise<CommandChatResponse> {
    const companyId =
      ctx.scope === 'group' ? (ctx.dataset.companies[0]?.companyId ?? 'group') : ctx.scope;
    const task = await requestResearch(ctx, { companyId, question: message });
    return {
      text: [
        '外部調査タスクを受け付けました（非同期で実行します）。',
        `質問: ${message}`,
        `状態: ${task.status} / Provider: ${task.provider}`,
        '',
        '※外部調査の結果は出典URL・取得日時付きで返し、社内データとは明確に分けて表示します。'
      ].join('\n'),
      uiHint: 'text',
      data: task,
      confidence: 'HIGH',
      evidence: [],
      toolsUsed: ['request_research']
    };
  }

  private async handleSendRequest(ctx: ToolContext, message: string): Promise<CommandChatResponse> {
    // 外部送信はLEVEL 4。内容・宛先・根拠を提示し、承認された場合のみ（Phase Aはdry-runで）実行する。
    const customer = findCustomer(ctx.dataset, message);
    const project = findProject(ctx.dataset, message);
    const companyId =
      project?.companyId ?? customer?.companyId ?? (ctx.scope === 'group' ? 'lcc' : ctx.scope);
    const target = customer?.name ?? project?.name ?? '宛先未特定';
    const draftText = customer
      ? `${customer.name}様への連絡文はチャットで確認済みの下書きを使用します。`
      : '送信対象の下書きを特定できなかったため、承認画面で内容を確認してください。';
    const approval = await requestApproval(ctx, {
      companyId,
      riskLevel: 4,
      action: '外部メッセージ送信（dry-run）',
      target,
      aiReason: `経営者の指示「${message}」に基づく送信依頼。送信内容・宛先・根拠を確認のうえ承認してください。`,
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
      text: [
        '外部送信はそのまま実行せず、承認リクエストを作成しました。',
        `宛先: ${target}`,
        `内容: ${draftText}`,
        `承認レベル: LEVEL 4（外部送信・データ変更）`,
        '承認された場合のみ送信します（現在はdry-run運用のため実送信は行いません）。'
      ].join('\n'),
      uiHint: 'approval',
      data: approval,
      confidence: 'HIGH',
      evidence: approval.evidence,
      toolsUsed: ['create_draft', 'request_approval'],
      approvalRequest: approval
    };
  }

  private async handleUnknown(ctx: ToolContext, message: string): Promise<CommandChatResponse> {
    return {
      text: [
        `「${message}」に確定データで答えられる情報が見つかりませんでした。推測では回答しません。`,
        '',
        '次のような質問に答えられます:',
        '・今月どう？ / 売上から / 現金大丈夫？ / 来月仕事足りる？',
        '・危ない現場は？ / A案件なぜ利益悪い？ / 請求漏れてない？',
        '・今日何をすべき？ / ○○さんの案件どう？ / この会社調べて'
      ].join('\n'),
      uiHint: 'text',
      confidence: 'UNKNOWN',
      evidence: [],
      toolsUsed: []
    };
  }
}

export { scopeLabel };
