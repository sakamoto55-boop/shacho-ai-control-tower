import type {
  Deal,
  DateRange,
  MoneyEntry,
  Pillar,
  PillarKind,
  PillarSummary,
  TimeEntry
} from './types.js';
import { withinRange } from '../utils/date.js';
import { grossProfitYen, isOpenDeal, STAGE_WIN_PROBABILITY, unpaidYen } from './dealRules.js';

export const PILLAR_KIND_LABELS: Record<PillarKind, string> = {
  service: '受注仕事',
  content: '発信',
  contract: '受託・代行',
  other: 'その他'
};

/**
 * これを下回る時給の柱は見直し対象にする（円）。
 * 一人事業では、自分の時間の値段を決めておかないと安い仕事で埋まる。
 */
export function minHourlyYen(): number {
  const value = Number(process.env.MIN_HOURLY_YEN);
  return Number.isFinite(value) && value > 0 ? value : 3000;
}

/**
 * 柱1本の成績を出す。
 * 粗利は「実際に入った金 − 実際に出た金」で見る。見込みは pipelineYen に分けておく。
 */
export function summarizePillar(
  pillar: Pillar,
  deals: Deal[],
  timeEntries: TimeEntry[],
  moneyEntries: MoneyEntry[],
  range?: DateRange
): PillarSummary {
  const ownDeals = deals.filter((deal) => deal.pillarId === pillar.id);
  const ownTime = timeEntries.filter(
    (entry) => entry.pillarId === pillar.id && withinRange(entry.date, range)
  );
  const ownMoney = moneyEntries.filter(
    (entry) => entry.pillarId === pillar.id && withinRange(entry.date, range)
  );

  const minutes = ownTime.reduce((sum, entry) => sum + entry.minutes, 0);
  const hours = minutes / 60;
  const incomeYen = ownMoney
    .filter((entry) => entry.kind === 'income')
    .reduce((sum, entry) => sum + entry.amountYen, 0);
  const expenseYen = ownMoney
    .filter((entry) => entry.kind === 'expense')
    .reduce((sum, entry) => sum + entry.amountYen, 0);
  const profitYen = incomeYen - expenseYen;

  const openDeals = ownDeals.filter(isOpenDeal);
  const pipelineYen = openDeals.reduce(
    (sum, deal) => sum + (grossProfitYen(deal) ?? 0) * STAGE_WIN_PROBABILITY[deal.stage],
    0
  );

  return {
    pillar,
    hours,
    incomeYen,
    expenseYen,
    profitYen,
    // 時間を1分も記録していない柱は、時給を出さずnullにする（0円と誤読させない）
    profitPerHourYen: hours > 0 ? profitYen / hours : null,
    openDealCount: openDeals.length,
    pipelineYen: Math.round(pipelineYen),
    unpaidYen: ownDeals.reduce((sum, deal) => sum + unpaidYen(deal, moneyEntries), 0)
  };
}

export function summarizeAll(
  pillars: Pillar[],
  deals: Deal[],
  timeEntries: TimeEntry[],
  moneyEntries: MoneyEntry[],
  range?: DateRange
): PillarSummary[] {
  return pillars.map((pillar) => summarizePillar(pillar, deals, timeEntries, moneyEntries, range));
}

/** 時給の高い順。時給が出せない柱（時間の記録なし）は後ろへ。 */
export function rankByHourly(summaries: PillarSummary[]): PillarSummary[] {
  return [...summaries].sort((a, b) => {
    if (a.profitPerHourYen === null && b.profitPerHourYen === null) return 0;
    if (a.profitPerHourYen === null) return 1;
    if (b.profitPerHourYen === null) return -1;
    return b.profitPerHourYen - a.profitPerHourYen;
  });
}

/** 見直し日が来た柱。検証中のまま放置されるのを防ぐ。 */
export function isReviewDue(pillar: Pillar, today: string): boolean {
  if (pillar.status === 'dropped') return false;
  return pillar.reviewOn !== null && pillar.reviewOn <= today;
}

export type TargetJudgement = 'met' | 'missed' | 'unknown';

/** 撤退基準（目標月粗利）に届いたかどうか。届かない場合の判断は本人がする。 */
export function judgeAgainstTarget(summary: PillarSummary): TargetJudgement {
  const target = summary.pillar.targetMonthlyProfitYen;
  if (target === null) return 'unknown';
  return summary.profitYen >= target ? 'met' : 'missed';
}

/**
 * 時間を使ったのに1円も生んでいない柱。
 * 一人事業で一番危ないのはこれ。気づかないまま数か月溶ける。
 */
export function isBleeding(summary: PillarSummary, minHours = 5): boolean {
  return summary.hours >= minHours && summary.profitYen <= 0;
}
