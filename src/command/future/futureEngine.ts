/**
 * Future Intelligence Engine（Phase X §10-§14）。
 *
 * 「今後起こりそうな問題・機会」を決定論的に探索する。
 * - 期間: 30 / 90 / 180 / 365日
 * - 未接続データを推測で補完しない（銀行未接続→CASH予測はINCOMPLETEと明示）
 * - Scenario Planning: 確定計算可能な部分はDeterministic Engine、不確実な部分は仮定として明示（§13）
 * - AIから未来の問いを提案できるが、勝手に行動しない（§14）
 */
import type { CompanyScope, DataConfidence, Evidence } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { filterDatasetByScope } from '../domain/scope.js';
import { computeCashForecast } from '../engines/cashForecast.js';
import { computeSalesSummary } from '../engines/sales.js';
import { computeProjectMargin } from '../engines/margin.js';
import { yen } from '../brief/generateBrief.js';

export type FutureInsightKind =
  | 'OPPORTUNITY'
  | 'RISK'
  | 'BOTTLENECK'
  | 'CAPACITY_RISK'
  | 'CASH_RISK'
  | 'SALES_GAP'
  | 'MARGIN_RISK'
  | 'PEOPLE_RISK'
  | 'SYSTEM_RISK'
  | 'INVESTMENT_OPPORTUNITY';

export interface FutureInsight {
  kind: FutureInsightKind;
  horizonDays: 30 | 90 | 180 | 365;
  statement: string;
  evidence: Evidence[];
  confidence: DataConfidence;
  /** 明示した仮定（決定論で確定できない部分） */
  assumptions: string[];
  /** 判定に不足しているData Gap ID */
  relatedGaps: string[];
  /** AIからの問いの提案（§14。行動はしない） */
  suggestedQuestion?: string;
}

export function computeFutureInsights(dataset: CommandDataset, scope: CompanyScope): FutureInsight[] {
  const scoped = filterDatasetByScope(dataset, scope);
  const insights: FutureInsight[] = [];
  const asOfDate = dataset.asOf.slice(0, 10);

  // --- SALES_GAP / BOTTLENECK: 受注残が何か月分か（仕事量の先行き） ---
  const backlog = scoped.projects
    .filter((p) => (p.stage === 'ordered' || p.stage === 'in_progress') && p.orderAmount > 0)
    .reduce((sum, p) => sum + p.orderAmount, 0);
  const sales = computeSalesSummary(dataset, scope);
  const monthlyPace = sales.landingForecast > 0 ? sales.landingForecast : sales.confirmedSales;
  if (monthlyPace > 0) {
    const backlogMonths = Math.round((backlog / monthlyPace) * 10) / 10;
    const evidence: Evidence[] = [
      { label: '受注残', value: yen(backlog), source: '案件台帳（決定論集計）', asOf: asOfDate },
      { label: '月次ペース', value: yen(monthlyPace), source: '当月着地予測', asOf: asOfDate }
    ];
    if (backlogMonths < 2) {
      insights.push({
        kind: 'SALES_GAP',
        horizonDays: 90,
        statement: `現在の受注残は月次ペースの約${backlogMonths}か月分です。このままでは3か月後に仕事量が不足する可能性があります。`,
        evidence,
        confidence: 'MEDIUM',
        assumptions: ['今後の月次売上ペースが当月着地と同水準で続くと仮定'],
        relatedGaps: [],
        suggestedQuestion: '営業パイプラインを確認しますか？'
      });
    } else {
      insights.push({
        kind: 'OPPORTUNITY',
        horizonDays: 90,
        statement: `受注残は月次ペースの約${backlogMonths}か月分あり、当面の仕事量は確保されています。`,
        evidence,
        confidence: 'MEDIUM',
        assumptions: ['月次ペースが同水準で続くと仮定'],
        relatedGaps: []
      });
    }
  }

  // --- CASH_RISK: 90日資金（銀行未接続なら正直にINCOMPLETE） ---
  const cash = computeCashForecast(dataset, scope);
  if (!cash.balanceKnown) {
    insights.push({
      kind: 'CASH_RISK',
      horizonDays: 90,
      statement:
        '銀行残高が接続されていないため、30/60/90日の資金予測は不完全（INCOMPLETE）です。将来の資金リスクを確定判定できません。',
      evidence: [],
      confidence: 'UNKNOWN',
      assumptions: [],
      relatedGaps: ['DG-004']
    });
  } else if (cash.minBalance.balance < 10_000_000) {
    insights.push({
      kind: 'CASH_RISK',
      horizonDays: 90,
      statement: `90日以内の最低残高が${yen(cash.minBalance.balance)}まで低下する見込みです（下限目安を確認してください）。`,
      evidence: [
        { label: '90日最低残高', value: yen(cash.minBalance.balance), source: '資金繰り決定論エンジン', asOf: asOfDate }
      ],
      confidence: 'MEDIUM',
      assumptions: ['入金・支払予定が現在の登録どおり実行されると仮定'],
      relatedGaps: ['DG-004'],
      suggestedQuestion: '入金前倒し・支払時期の調整を検討しますか？'
    });
  }

  // --- MARGIN_RISK: 予測粗利が計画を下回る案件の傾向 ---
  const margins = scoped.projects
    .filter((p) => p.orderAmount > 0)
    .map((p) => computeProjectMargin(dataset, p))
    .filter((m) => m.forecastMarginRate !== null);
  const lowMargin = margins.filter((m) => (m.forecastMarginRate as number) < m.plannedMarginRate - 0.03);
  if (lowMargin.length >= 1 && margins.length > 0) {
    insights.push({
      kind: 'MARGIN_RISK',
      horizonDays: 30,
      statement: `進行中${margins.length}件のうち${lowMargin.length}件で予測粗利率が計画を3pt以上下回っています。同じ原価構造の受注が続くと期の粗利目標に届かないリスクがあります。`,
      evidence: lowMargin.slice(0, 3).flatMap((m) => m.evidence.slice(0, 1)),
      confidence: 'HIGH',
      assumptions: [],
      relatedGaps: ['DG-001']
    });
  }

  // --- CAPACITY / PEOPLE: 実績人工が未接続のため確定判定不可（正直に） ---
  if (scoped.dailyReports.length === 0) {
    insights.push({
      kind: 'CAPACITY_RISK',
      horizonDays: 90,
      statement:
        '実績人工（日報）が未接続のため、施工キャパシティと受注残の突合ができません。人員逼迫・過剰の先行判定はデータ接続後に可能になります。',
      evidence: [],
      confidence: 'UNKNOWN',
      assumptions: [],
      relatedGaps: ['DG-001', 'DG-003']
    });
  }

  // --- OPPORTUNITY: パイプライン（提出済み見積の期待値） ---
  const pipeline = scoped.estimates
    .filter((e) => e.status === 'submitted')
    .reduce((sum, e) => sum + e.amount * (e.probability ?? 0.5), 0);
  if (pipeline > 0) {
    insights.push({
      kind: 'OPPORTUNITY',
      horizonDays: 90,
      statement: `提出済み見積の期待値は${yen(Math.round(pipeline))}です。追客の優先順位付けで受注残の谷を埋められる可能性があります。`,
      evidence: [
        { label: 'パイプライン期待値', value: yen(Math.round(pipeline)), source: '見積台帳（確度加重）', asOf: asOfDate }
      ],
      confidence: 'MEDIUM',
      assumptions: ['見積確度は登録値（未登録は50%）を使用'],
      relatedGaps: []
    });
  }

  return insights;
}

/** Scenario Planning（§13）。確定計算は決定論、不確実部分はassumptionsへ明示 */
export interface ScenarioInput {
  label: string;
  salesDeltaPct?: number;
  headcountDelta?: number;
  oneTimeInvestment?: number;
}

export interface ScenarioResult {
  label: string;
  lines: string[];
  assumptions: string[];
  evidence: Evidence[];
  confidence: DataConfidence;
}

export function parseScenario(message: string): ScenarioInput | null {
  const salesDrop = message.match(/売上.{0,4}?(\d+)[%％].{0,4}(落ち|減|下が)/);
  if (salesDrop) return { label: `売上${salesDrop[1]}%減少シナリオ`, salesDeltaPct: -Number(salesDrop[1]) };
  const salesUp = message.match(/売上.{0,4}?(\d+)[%％].{0,4}(伸び|増|上が)/);
  if (salesUp) return { label: `売上${salesUp[1]}%増加シナリオ`, salesDeltaPct: Number(salesUp[1]) };
  const quit = message.match(/(\d+)人.{0,4}(辞め|退職|抜け)/);
  if (quit) return { label: `${quit[1]}人退職シナリオ`, headcountDelta: -Number(quit[1]) };
  const invest = message.match(/(\d+(?:,\d{3})*)(万円|百万円|円).{0,6}(投資|使っ|購入)/);
  if (invest) {
    const raw = Number(invest[1].replace(/,/g, ''));
    const amount = invest[2] === '万円' ? raw * 10_000 : invest[2] === '百万円' ? raw * 1_000_000 : raw;
    return { label: `${invest[1]}${invest[2]}投資シナリオ`, oneTimeInvestment: amount };
  }
  if (/このまま(なら|だと|いくと)/.test(message)) return { label: '現状継続シナリオ' };
  return null;
}

export function runScenario(
  dataset: CommandDataset,
  scope: CompanyScope,
  scenario: ScenarioInput
): ScenarioResult {
  const asOfDate = dataset.asOf.slice(0, 10);
  const sales = computeSalesSummary(dataset, scope);
  const cash = computeCashForecast(dataset, scope);
  const lines: string[] = [];
  const assumptions: string[] = [];
  const evidence: Evidence[] = [
    { label: '現在の着地予測', value: yen(sales.landingForecast), source: '決定論エンジン', asOf: asOfDate }
  ];

  if (scenario.salesDeltaPct !== undefined) {
    const adjusted = Math.round(sales.landingForecast * (1 + scenario.salesDeltaPct / 100));
    const marginRate = 0.27; // 第13期目標粗利率（候補値）を仮定として明示
    const profitDelta = Math.round((adjusted - sales.landingForecast) * marginRate);
    lines.push(
      `月次着地は${yen(sales.landingForecast)} → ${yen(adjusted)}（${scenario.salesDeltaPct > 0 ? '+' : ''}${scenario.salesDeltaPct}%）になります。`,
      `粗利影響は概算${yen(profitDelta)}/月（粗利率27%仮定）です。`
    );
    assumptions.push('粗利率27%（第13期目標候補値）を仮定', '固定費は不変と仮定');
  }
  if (scenario.headcountDelta !== undefined && scenario.headcountDelta < 0) {
    const n = Math.abs(scenario.headcountDelta);
    lines.push(
      `${n}人減少した場合の施工キャパシティへの影響は、実績人工（日報）が未接続のため確定計算できません。`,
      `参考: 社員マスタは${dataset.employees.length}名です（減少率 約${Math.round((n / Math.max(dataset.employees.length, 1)) * 100)}%）。`
    );
    assumptions.push('人工単価・案件別配置が未接続のため影響額は算出しない（推測で補完しない）');
  }
  if (scenario.oneTimeInvestment !== undefined) {
    if (cash.balanceKnown) {
      const newMin = cash.minBalance.balance - scenario.oneTimeInvestment;
      lines.push(
        `${yen(scenario.oneTimeInvestment)}を即時支出した場合、90日最低残高は${yen(cash.minBalance.balance)} → ${yen(newMin)}になります。`,
        newMin < 8_000_000 ? '下限目安を割り込む可能性があります。投資時期の分割・後ろ倒しを検討してください。' : '資金面では吸収可能な範囲です。'
      );
      evidence.push({ label: '90日最低残高（現状）', value: yen(cash.minBalance.balance), source: '資金繰り決定論エンジン', asOf: asOfDate });
      assumptions.push('投資は即時一括支出と仮定', '銀行残高は未接続のため登録済み口座残高ベース');
    } else {
      lines.push('銀行残高が未接続のため、投資後の資金残高は確定計算できません（接続後に30/60/90日で判定できます）。');
    }
  }
  if (lines.length === 0) {
    lines.push(
      `現状継続の場合: 月次着地${yen(sales.landingForecast)}、90日最低残高${cash.balanceKnown ? yen(cash.minBalance.balance) : '不明（銀行未接続）'}の見込みです。`
    );
    assumptions.push('入金・支払・受注ペースが現在の登録どおりと仮定');
  }

  return {
    label: scenario.label,
    lines,
    assumptions,
    evidence,
    confidence: cash.balanceKnown ? 'MEDIUM' : 'LOW'
  };
}
