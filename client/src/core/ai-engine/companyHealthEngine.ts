// 会社健康度スコアエンジン
// 9カテゴリで経営状態を0-100点評価し、グレード（A/B/C/D）を算出する
// 書き込み禁止: 読み取り専用ロジックのみ

import type { CompanyHealthScore, HealthCategory } from './aiEngineTypes'
import type {
  UnifiedBusinessMetric,
  UnifiedNotification,
  UnifiedScheduleItem,
} from '../providers/providerTypes'

function good(comment: string): HealthCategory {
  return { score: 100, status: 'good', comment }
}
function warning(score: number, comment: string): HealthCategory {
  return { score, status: 'warning', comment }
}
function danger(score: number, comment: string): HealthCategory {
  return { score, status: 'danger', comment }
}

function getMetricValue(metrics: UnifiedBusinessMetric[], key: string): number | null {
  const m = metrics.find((m) => m.metricKey === key)
  return m ? m.value : null
}

export function calculateCompanyHealth(
  metrics: UnifiedBusinessMetric[],
  notifications: UnifiedNotification[],
  schedule: UnifiedScheduleItem[]
): CompanyHealthScore {
  const now = new Date().toISOString()

  // ── 資金繰り ──
  const cash = getMetricValue(metrics, 'cash_balance')
  let cashflow: HealthCategory
  if (cash === null) cashflow = warning(60, 'データ未取得')
  else if (cash < 5_000_000) cashflow = danger(20, `現金残高¥${Math.round(cash / 10000)}万 — 即時対応が必要です`)
  else if (cash < 15_000_000) cashflow = warning(55, `現金残高¥${Math.round(cash / 10000)}万 — 銀行対応を優先してください`)
  else cashflow = good(`現金残高¥${Math.round(cash / 10000)}万 — 安定しています`)

  // ── 粗利率 ──
  const gpr = getMetricValue(metrics, 'gross_profit_rate')
  let grossProfit: HealthCategory
  if (gpr === null) grossProfit = warning(60, 'データ未取得')
  else if (gpr < 25) grossProfit = danger(25, `粗利率${gpr}% — 目標を大きく下回っています`)
  else if (gpr < 30) grossProfit = warning(60, `粗利率${gpr}% — 目標30%を下回っています`)
  else grossProfit = good(`粗利率${gpr}% — 良好です`)

  // ── 未請求 ──
  const unbilled = getMetricValue(metrics, 'unbilled')
  let unbilledCat: HealthCategory
  if (unbilled === null) unbilledCat = warning(60, 'データ未取得')
  else if (unbilled > 3_000_000) unbilledCat = danger(20, `未請求¥${Math.round(unbilled / 10000)}万 — 早急に請求書を発行してください`)
  else if (unbilled > 1_000_000) unbilledCat = warning(55, `未請求¥${Math.round(unbilled / 10000)}万 — 請求確認を行ってください`)
  else unbilledCat = good(`未請求¥${Math.round((unbilled ?? 0) / 10000)}万 — 問題ありません`)

  // ── 未回収 ──
  const uncollected = getMetricValue(metrics, 'uncollected')
  let uncollectedCat: HealthCategory
  if (uncollected === null) uncollectedCat = warning(60, 'データ未取得')
  else if (uncollected > 2_000_000) uncollectedCat = danger(25, `未回収¥${Math.round(uncollected / 10000)}万 — 督促対応が必要です`)
  else if (uncollected > 500_000) uncollectedCat = warning(60, `未回収¥${Math.round(uncollected / 10000)}万 — 確認してください`)
  else uncollectedCat = good(`未回収¥${Math.round((uncollected ?? 0) / 10000)}万 — 問題ありません`)

  // ── 事故 ──
  const accidentNotifs = notifications.filter((n) => n.category === 'accident' || n.category === 'sos')
  const criticalAccidents = accidentNotifs.filter((n) => n.urgency === 'critical')
  let accidentCat: HealthCategory
  if (criticalAccidents.length > 0) accidentCat = danger(10, `緊急事故・SOS ${criticalAccidents.length}件 — 即時対応が必要です`)
  else if (accidentNotifs.length > 0) accidentCat = warning(50, `事故・SOS通知 ${accidentNotifs.length}件 — 状況確認が必要です`)
  else {
    const accidentMetric = getMetricValue(metrics, 'accident_count')
    if (accidentMetric && accidentMetric > 0) accidentCat = warning(50, `今月事故${accidentMetric}件 — 再発防止策を確認してください`)
    else accidentCat = good('事故・SOS なし')
  }

  // ── 人員 ──
  const personnelNotifs = notifications.filter((n) => n.category === 'absence' || n.category === 'vehicle')
  let personnelCat: HealthCategory
  if (personnelNotifs.length >= 2) personnelCat = danger(30, `人員・車両問題 ${personnelNotifs.length}件 — 代替対応が必要です`)
  else if (personnelNotifs.length === 1) personnelCat = warning(60, `人員・車両問題 1件 — ${personnelNotifs[0].title}`)
  else personnelCat = good('人員・車両問題なし')

  // ── 営業（売上） ──
  const revenue = getMetricValue(metrics, 'monthly_revenue')
  let salesCat: HealthCategory
  if (revenue === null) salesCat = warning(60, 'データ未取得')
  else if (revenue < 3_000_000) salesCat = danger(20, `今月売上¥${Math.round(revenue / 10000)}万 — 著しく低下しています`)
  else if (revenue < 5_000_000) salesCat = warning(55, `今月売上¥${Math.round(revenue / 10000)}万 — 目標を下回っています`)
  else salesCat = good(`今月売上¥${Math.round(revenue / 10000)}万 — 良好です`)

  // ── 社内SOS ──
  const sosNotifs = notifications.filter((n) => n.urgency === 'critical')
  let internalSOSCat: HealthCategory
  if (sosNotifs.length >= 2) internalSOSCat = danger(10, `緊急通知 ${sosNotifs.length}件 — 複数の緊急事態が発生しています`)
  else if (sosNotifs.length === 1) internalSOSCat = warning(45, `緊急通知 1件 — ${sosNotifs[0].title}`)
  else internalSOSCat = good('緊急通知なし')

  // ── 予定過密 ──
  const todayScheduleCount = schedule.filter((s) => {
    if (!s.startAt) return false
    const d = new Date(s.startAt)
    const today = new Date()
    return d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
  }).length
  let scheduleLoadCat: HealthCategory
  if (todayScheduleCount >= 6) scheduleLoadCat = danger(40, `本日予定${todayScheduleCount}件 — 過密スケジュールです`)
  else if (todayScheduleCount >= 4) scheduleLoadCat = warning(65, `本日予定${todayScheduleCount}件 — 余裕を持って対応してください`)
  else scheduleLoadCat = good(`本日予定${todayScheduleCount}件 — 対応可能です`)

  const breakdown = {
    cashflow,
    grossProfit,
    unbilled: unbilledCat,
    uncollected: uncollectedCat,
    accident: accidentCat,
    personnel: personnelCat,
    sales: salesCat,
    internalSOS: internalSOSCat,
    scheduleLoad: scheduleLoadCat,
  }

  const total = Math.round(
    Object.values(breakdown).reduce((sum, cat) => sum + cat.score, 0) / 9
  )

  const grade: CompanyHealthScore['grade'] =
    total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D'

  const topRisks = Object.values(breakdown)
    .filter((cat) => cat.status === 'danger')
    .map((cat) => cat.comment)
    .slice(0, 3)

  return {
    total,
    grade,
    breakdown,
    topRisks,
    generatedAt: now,
    readOnly: true,
    writeEnabled: false,
  }
}
