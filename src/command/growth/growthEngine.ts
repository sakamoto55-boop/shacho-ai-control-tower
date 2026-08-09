/**
 * Autonomous Growth Loop — 観測・変化検知・パターン検知（Phase GROWTH §1-§6）。
 *
 * OBSERVE→DETECT→DIAGNOSE→HYPOTHESIZE→…→LEARN のループの決定論部分。
 * - 決定論検査を先に実施し、異常・変化がある場合のみAI Reasoningを起動する（§3）
 * - 「前回から何が変わったか」を検出する（§4）
 * - 単発異常と繰り返し問題（3回以上）を区別する（§5）
 * - Root CauseはCandidate（HYPOTHESIS）として保持し、FACTへ昇格させない（§6）
 */
import type { CompanyScope, DataConfidence, Evidence } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { computeSalesSummary } from '../engines/sales.js';
import { computeKpiSnapshot } from '../engines/kpi.js';
import { buildAlerts, activeAlerts } from '../engines/alerts.js';
import { detectSalesLeaks } from '../engines/salesLeak.js';
import { checkInvoices } from '../engines/invoiceChecks.js';
import { computeProjectMargin } from '../engines/margin.js';
import { checkDataQuality } from '../domain/dataQuality.js';
import { yen } from '../brief/generateBrief.js';

export type GrowthDomain = 'COMPANY' | 'AI' | 'DATA';

/** 定点観測スナップショット（決定論。§3のDaily観測の単位） */
export interface GrowthSnapshot {
  takenAt: string;
  scope: CompanyScope;
  salesLanding: number;
  marginForecastPct: number;
  leakCount: number;
  uninvoicedTotal: number;
  overdueTotal: number;
  criticalAlerts: number;
  warningAlerts: number;
  lowMarginProjects: number;
  dataQualityIssues: number;
}

export function takeSnapshot(dataset: CommandDataset, scope: CompanyScope): GrowthSnapshot {
  const alerts = activeAlerts(buildAlerts(dataset, scope, []));
  const kpi = computeKpiSnapshot(dataset, scope, buildAlerts(dataset, scope, []));
  const sales = computeSalesSummary(dataset, scope);
  const invoices = checkInvoices(dataset, scope);
  const margins = dataset.projects
    .filter((p) => p.orderAmount !== null && p.orderAmount > 0)
    .map((p) => computeProjectMargin(dataset, p))
    .filter((m) => m.forecastMarginRate !== null);
  const lowMargin = margins.filter(
    (m) => (m.forecastMarginRate as number) < (m.plannedMarginRate ?? 0) - 0.03
  );
  return {
    takenAt: dataset.asOf,
    scope,
    salesLanding: sales.landingForecast,
    marginForecastPct: Number(kpi.kpis.find((k) => k.key === 'margin_forecast')?.value ?? 0),
    leakCount: detectSalesLeaks(dataset, scope).length,
    uninvoicedTotal: invoices.uninvoicedCompletedTotal,
    overdueTotal: invoices.overdueReceivableTotal,
    criticalAlerts: alerts.filter((a) => a.severity === 'CRITICAL').length,
    warningAlerts: alerts.filter((a) => a.severity === 'WARNING').length,
    lowMarginProjects: lowMargin.length,
    dataQualityIssues: checkDataQuality(dataset, scope).length
  };
}

export type GrowthSignalKind =
  | 'MARGIN_WORSENED'
  | 'LEAKS_INCREASED'
  | 'UNINVOICED_INCREASED'
  | 'OVERDUE_INCREASED'
  | 'ALERTS_INCREASED'
  | 'DATA_QUALITY_WORSENED'
  | 'SALES_PACE_DROPPED'
  | 'IMPROVED';

export interface GrowthSignal {
  kind: GrowthSignalKind;
  domain: GrowthDomain;
  statement: string;
  evidence: Evidence[];
  /** 悪化=true / 改善=false */
  negative: boolean;
}

/** 変化検知（§4）。現在値ではなく「前回からの変化」を返す */
export function detectChanges(previous: GrowthSnapshot, current: GrowthSnapshot): GrowthSignal[] {
  const signals: GrowthSignal[] = [];
  const asOf = current.takenAt.slice(0, 10);
  const ev = (label: string, before: number | string, after: number | string): Evidence => ({
    label,
    value: `前回 ${before} → 今回 ${after}`,
    source: 'Growth観測（決定論スナップショット比較）',
    asOf
  });

  if (current.marginForecastPct < previous.marginForecastPct - 0.5) {
    signals.push({
      kind: 'MARGIN_WORSENED',
      domain: 'COMPANY',
      statement: `全社予測粗利率が${previous.marginForecastPct}%→${current.marginForecastPct}%へ悪化しました`,
      evidence: [ev('予測粗利率', `${previous.marginForecastPct}%`, `${current.marginForecastPct}%`)],
      negative: true
    });
  }
  if (current.leakCount > previous.leakCount) {
    signals.push({
      kind: 'LEAKS_INCREASED',
      domain: 'COMPANY',
      statement: `営業要対応（見積停滞・追客漏れ等）が${previous.leakCount}件→${current.leakCount}件へ増加しました`,
      evidence: [ev('営業要対応件数', previous.leakCount, current.leakCount)],
      negative: true
    });
  }
  if (current.uninvoicedTotal > previous.uninvoicedTotal) {
    signals.push({
      kind: 'UNINVOICED_INCREASED',
      domain: 'COMPANY',
      statement: `完工未請求が${yen(previous.uninvoicedTotal)}→${yen(current.uninvoicedTotal)}へ増加しました`,
      evidence: [ev('完工未請求', yen(previous.uninvoicedTotal), yen(current.uninvoicedTotal))],
      negative: true
    });
  }
  if (current.overdueTotal > previous.overdueTotal) {
    signals.push({
      kind: 'OVERDUE_INCREASED',
      domain: 'COMPANY',
      statement: `期日超過未入金が${yen(previous.overdueTotal)}→${yen(current.overdueTotal)}へ増加しました`,
      evidence: [ev('期日超過未入金', yen(previous.overdueTotal), yen(current.overdueTotal))],
      negative: true
    });
  }
  if (current.criticalAlerts > previous.criticalAlerts) {
    signals.push({
      kind: 'ALERTS_INCREASED',
      domain: 'COMPANY',
      statement: `重大アラートが${previous.criticalAlerts}件→${current.criticalAlerts}件へ増加しました`,
      evidence: [ev('重大アラート', previous.criticalAlerts, current.criticalAlerts)],
      negative: true
    });
  }
  if (current.dataQualityIssues > previous.dataQualityIssues) {
    signals.push({
      kind: 'DATA_QUALITY_WORSENED',
      domain: 'DATA',
      statement: `データ品質の検出件数が${previous.dataQualityIssues}件→${current.dataQualityIssues}件へ増加しました`,
      evidence: [ev('データ品質検出', previous.dataQualityIssues, current.dataQualityIssues)],
      negative: true
    });
  }
  if (current.salesLanding < previous.salesLanding * 0.95) {
    signals.push({
      kind: 'SALES_PACE_DROPPED',
      domain: 'COMPANY',
      statement: `売上着地予測が${yen(previous.salesLanding)}→${yen(current.salesLanding)}へ低下しました`,
      evidence: [ev('着地予測', yen(previous.salesLanding), yen(current.salesLanding))],
      negative: true
    });
  }
  // 改善も検知する（§40の測定に使う）
  if (
    current.leakCount < previous.leakCount &&
    current.uninvoicedTotal <= previous.uninvoicedTotal
  ) {
    signals.push({
      kind: 'IMPROVED',
      domain: 'COMPANY',
      statement: `営業要対応が${previous.leakCount}件→${current.leakCount}件へ減少しました`,
      evidence: [ev('営業要対応件数', previous.leakCount, current.leakCount)],
      negative: false
    });
  }
  return signals;
}

/** パターン検知（§5）。同種シグナルが閾値回以上で「繰り返し問題」候補 */
export interface GrowthPattern {
  kind: GrowthSignalKind;
  occurrences: number;
  statement: string;
  firstSeen: string;
  lastSeen: string;
}

export function detectPatterns(
  history: Array<{ takenAt: string; signals: GrowthSignal[] }>,
  threshold = 3
): GrowthPattern[] {
  const counts = new Map<GrowthSignalKind, { count: number; first: string; last: string }>();
  for (const entry of history) {
    for (const signal of entry.signals) {
      if (!signal.negative) continue;
      const current = counts.get(signal.kind) ?? { count: 0, first: entry.takenAt, last: entry.takenAt };
      current.count += 1;
      current.last = entry.takenAt;
      counts.set(signal.kind, current);
    }
  }
  return [...counts.entries()]
    .filter(([, v]) => v.count >= threshold)
    .map(([kind, v]) => ({
      kind,
      occurrences: v.count,
      statement: `「${kind}」が${v.count}回繰り返し検出されています（単発異常ではなく構造的な問題の可能性）`,
      firstSeen: v.first,
      lastSeen: v.last
    }));
}

/** Root Cause Candidate（§6）。即断せずHYPOTHESISとして保持 */
export interface RootCauseCandidate {
  observedFact: string;
  possibleCauses: string[];
  evidence: Evidence[];
  confidence: DataConfidence;
}

export function buildRootCauseCandidates(
  dataset: CommandDataset,
  scope: CompanyScope,
  signal: GrowthSignal
): RootCauseCandidate {
  const possibleCauses: string[] = [];
  if (signal.kind === 'MARGIN_WORSENED') {
    const margins = dataset.projects
      .filter((p) => p.orderAmount !== null && p.orderAmount > 0)
      .map((p) => computeProjectMargin(dataset, p))
      .filter((m) => m.forecastMarginRate !== null && m.plannedMarginRate !== null && (m.forecastMarginRate as number) < (m.plannedMarginRate as number) - 0.03);
    const driverCounts = new Map<string, number>();
    for (const margin of margins) {
      for (const driver of margin.varianceDrivers) {
        driverCounts.set(driver.category, (driverCounts.get(driver.category) ?? 0) + 1);
      }
    }
    for (const [category, count] of [...driverCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      possibleCauses.push(`${category}費の超過が${count}件で共通（単価設定・見積基準の問題の可能性）`);
    }
  }
  if (signal.kind === 'LEAKS_INCREASED') {
    possibleCauses.push('特定担当への案件集中', '見積作成リードタイムの増加', '追客ルールの形骸化');
  }
  if (signal.kind === 'UNINVOICED_INCREASED') {
    possibleCauses.push('完工報告から請求起票までの手順遅延', '請求担当の業務集中');
  }
  if (possibleCauses.length === 0) possibleCauses.push('原因候補を特定するにはデータが不足しています');
  return {
    observedFact: signal.statement,
    possibleCauses,
    evidence: signal.evidence,
    confidence: 'LOW' // AI推測=HYPOTHESIS。FACTに昇格させない
  };
}

/** 実験結果の評価（§13-§15）。実施しただけでは成功扱いしない */
export interface ExperimentEvaluation {
  verdict: 'SUCCESS' | 'FAILURE' | 'INCONCLUSIVE';
  delta: string;
  targetAchievement: string;
  confidence: DataConfidence;
}

export function evaluateExperimentResult(
  baseline: number,
  after: number,
  target: number,
  options: { lowerIsBetter?: boolean; sampleNote?: string } = {}
): ExperimentEvaluation {
  const improved = options.lowerIsBetter ? after < baseline : after > baseline;
  const achieved = options.lowerIsBetter ? after <= target : after >= target;
  const deltaPct = baseline !== 0 ? Math.round(((after - baseline) / Math.abs(baseline)) * 1000) / 10 : 0;
  const verdict: ExperimentEvaluation['verdict'] = achieved
    ? 'SUCCESS'
    : improved
      ? 'INCONCLUSIVE'
      : 'FAILURE';
  return {
    verdict,
    delta: `${baseline} → ${after}（${deltaPct > 0 ? '+' : ''}${deltaPct}%）`,
    targetAchievement: achieved ? `目標${target}を達成` : `目標${target}に未達`,
    confidence: options.sampleNote ? 'LOW' : 'MEDIUM'
  };
}
