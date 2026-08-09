/**
 * アラート集約エンジン。
 * 各決定論エンジンの検出結果をSeverity付きアラートへ変換し、
 * 経営判断Memory（Decision）で有効期間中のものは抑制マークを付ける。
 * CRITICALのみ即時通知対象。その他は朝Brief等へまとめる。
 */
import type { AlertSeverity, CommandAlert, CompanyScope, Decision } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { jstDate } from '../utils/jst.js';
import { computeCashForecast, horizonBalance } from './cashForecast.js';
import { checkInvoices } from './invoiceChecks.js';
import { findMarginDeteriorations } from './margin.js';
import { computeSalesSummary } from './sales.js';
import {
  detectSalesLeaks,
  DEFAULT_LEAK_THRESHOLDS,
  type SalesLeakThresholds
} from './salesLeak.js';

export interface AlertThresholds {
  /** 将来最低残高がこの額を下回ったらWARNING */
  cashFloor: number;
  /** 将来最低残高が現在残高×この比率を下回ったらWATCH（通常より低下） */
  cashDipRatio: number;
  /** 売上着地の目標比マイナスがこの率を超えたらWARNING */
  salesGapRate: number;
  /** 粗利悪化幅がこの率以上でWATCH、2倍でWARNING */
  marginDrop: number;
  leak: SalesLeakThresholds;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  cashFloor: 10_000_000,
  cashDipRatio: 0.85,
  salesGapRate: 0.03,
  marginDrop: 0.03,
  leak: DEFAULT_LEAK_THRESHOLDS
};

function isDecisionActive(decision: Decision, today: string): boolean {
  if (decision.status !== 'active') return false;
  // validUntilのないDecisionは「永久抑制事故」を防ぐため無効として扱う
  if (!decision.validUntil) return false;
  if (decision.validUntil < today) return false;
  return true;
}

function findSuppressingDecision(
  decisions: Decision[],
  today: string,
  kind: string,
  companyId: string,
  projectId?: string
): Decision | undefined {
  return decisions.find(
    (decision) =>
      isDecisionActive(decision, today) &&
      decision.companyId === companyId &&
      (decision.suppressAlertKinds ?? []).includes(kind) &&
      (decision.projectId === undefined || decision.projectId === projectId)
  );
}

export function buildAlerts(
  dataset: CommandDataset,
  scope: CompanyScope,
  decisions: Decision[] = [],
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS
): CommandAlert[] {
  const today = jstDate(dataset.asOf);
  const alerts: CommandAlert[] = [];
  let seq = 0;
  const push = (
    kind: CommandAlert['kind'],
    severity: AlertSeverity,
    companyId: string,
    title: string,
    detail: string,
    evidence: CommandAlert['evidence'],
    projectId?: string
  ) => {
    const suppressing = findSuppressingDecision(decisions, today, kind, companyId, projectId);
    alerts.push({
      alertId: `alert-${today}-${seq++}`,
      kind,
      severity,
      companyId,
      projectId,
      title,
      detail,
      evidence,
      suppressedByDecisionId: suppressing?.decisionId,
      createdAt: dataset.asOf
    });
  };

  // 資金: 30/90日圏の最低残高
  const cash = computeCashForecast(dataset, scope);
  const day30 = horizonBalance(cash, 30);
  const companyIdForScope =
    scope === 'group' ? (dataset.companies[0]?.companyId ?? 'group') : scope;
  if (!cash.balanceKnown) {
    // 残高不明はエラーであり「問題なし」ではない
    push(
      'cash_low',
      'WARNING',
      companyIdForScope,
      '銀行残高データが取得できていません',
      '現預金の現在値が不明のため、資金繰りを「問題なし」と判断できません。データ接続を確認してください。',
      []
    );
  } else if (cash.minBalance.balance < 0) {
    push(
      'cash_low',
      'CRITICAL',
      companyIdForScope,
      '資金ショートの恐れ',
      `${cash.minBalance.date}に予測残高が${cash.minBalance.balance.toLocaleString()}円まで低下します。`,
      cash.evidence.slice(0, 5)
    );
  } else if (cash.minBalance.balance < thresholds.cashFloor) {
    push(
      'cash_low',
      'WARNING',
      companyIdForScope,
      '将来現金残高が下限目安を下回ります',
      `${cash.minBalance.date}に予測残高${cash.minBalance.balance.toLocaleString()}円（下限目安${thresholds.cashFloor.toLocaleString()}円）。`,
      cash.evidence.slice(0, 5)
    );
  } else if (cash.minBalance.balance < cash.currentBalance * thresholds.cashDipRatio) {
    push(
      'cash_low',
      'WATCH',
      companyIdForScope,
      '30日圏の現金残高が通常より低下します',
      `月末の支払集中により${cash.minBalance.date}に予測残高${cash.minBalance.balance.toLocaleString()}円（現在${cash.currentBalance.toLocaleString()}円、30日後${day30.toLocaleString()}円）。`,
      cash.evidence.slice(0, 5)
    );
  }

  // 売上着地
  const sales = computeSalesSummary(dataset, scope);
  if (sales.targetGapRate !== null && sales.targetGapRate <= -thresholds.salesGapRate) {
    push(
      'sales_landing_gap',
      'WARNING',
      companyIdForScope,
      `当月売上着地が目標比${(sales.targetGapRate * 100).toFixed(1)}%`,
      `着地予測${(sales.landingForecast as number).toLocaleString()}円 / 目標${(sales.target as number).toLocaleString()}円。不足額${(sales.shortfall as number).toLocaleString()}円。`,
      sales.evidence.slice(0, 6)
    );
  }

  // 粗利悪化
  for (const item of findMarginDeteriorations(dataset, scope, thresholds.marginDrop)) {
    const severity: AlertSeverity = item.drop >= thresholds.marginDrop * 2 ? 'WARNING' : 'WATCH';
    push(
      'margin_drop',
      severity,
      item.margin.companyId,
      `${item.margin.projectName} の予測粗利が${((item.margin.plannedMarginRate ?? 0) * 100).toFixed(1)}%→${((item.margin.forecastMarginRate as number) * 100).toFixed(1)}%へ低下`,
      `主因: ${item.margin.varianceDrivers.map((driver) => `${driver.label}費 +${driver.diff.toLocaleString()}円`).join('、') || '原価内訳を確認してください'}。`,
      item.margin.evidence,
      item.margin.projectId
    );
  }

  // 営業漏れ
  for (const leak of detectSalesLeaks(dataset, scope, thresholds.leak)) {
    // §検収5-6: PROVISIONAL status由来は確定Alertに昇格させない（候補=WATCH止まり）
    const severity: AlertSeverity =
      leak.kind === 'inquiry_unanswered' && !leak.provisional ? 'WARNING' : 'WATCH';
    const companyId =
      dataset.projects.find((project) => project.projectId === leak.projectId)?.companyId ??
      companyIdForScope;
    push(leak.kind, severity, companyId, leak.title, leak.detail, leak.evidence, leak.projectId);
  }

  // 請求・入金
  const invoiceCheck = checkInvoices(dataset, scope);
  for (const issue of invoiceCheck.issues) {
    const companyId =
      dataset.projects.find((project) => project.projectId === issue.projectId)?.companyId ??
      companyIdForScope;
    push(
      issue.kind,
      'WARNING',
      companyId,
      issue.title,
      issue.detail,
      issue.evidence,
      issue.projectId
    );
  }

  const severityOrder: Record<AlertSeverity, number> = {
    CRITICAL: 0,
    WARNING: 1,
    WATCH: 2,
    INFO: 3
  };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

/** 抑制されていないアラートのみ（通知・Brief用） */
export function activeAlerts(alerts: CommandAlert[]): CommandAlert[] {
  return alerts.filter((alert) => !alert.suppressedByDecisionId);
}
