import type { Deal, DealStage, MoneyEntry } from './types.js';
import { daysBetween } from '../utils/date.js';

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  inquiry: '引き合い',
  talking: 'やり取り中',
  quoted: '見積提出済',
  won: '受注',
  delivering: '作業中',
  invoiced: '請求済',
  paid: '入金済',
  lost: '失注'
};

/** まだ終わっていない案件の段階 */
export const OPEN_STAGES: DealStage[] = [
  'inquiry',
  'talking',
  'quoted',
  'won',
  'delivering',
  'invoiced'
];

export function isOpenDeal(deal: Deal): boolean {
  return OPEN_STAGES.includes(deal.stage);
}

/**
 * 段階ごとの「放置してよい日数」。
 * 引き合いと見積後は冷めるのが早いので短い。一人だと数日で連絡が途切れて失注する。
 */
export const STALL_DAYS: Record<DealStage, number> = {
  inquiry: 2,
  talking: 4,
  quoted: 5,
  won: 7,
  delivering: 7,
  invoiced: 14,
  paid: Number.POSITIVE_INFINITY,
  lost: Number.POSITIVE_INFINITY
};

export interface StallCheck {
  stalled: boolean;
  idleDays: number;
  limitDays: number;
}

/** 最後に動かした日からの放置日数を見る。 */
export function checkStall(deal: Deal, today: string): StallCheck {
  const idleDays = daysBetween(deal.lastTouchedOn, today);
  const limitDays = STALL_DAYS[deal.stage];
  return {
    stalled: isOpenDeal(deal) && idleDays > limitDays,
    idleDays,
    limitDays
  };
}

export function isActionOverdue(deal: Deal, today: string): boolean {
  if (!isOpenDeal(deal) || deal.nextActionOn === null) return false;
  return deal.nextActionOn < today;
}

export function isActionDueToday(deal: Deal, today: string): boolean {
  if (!isOpenDeal(deal) || deal.nextActionOn === null) return false;
  return deal.nextActionOn === today;
}

/**
 * 段階別の受注確度。見込み金額を重み付けするために使う。
 * 一人事業は案件数が少なく平均に寄らないので、あくまで目安として扱う。
 */
export const STAGE_WIN_PROBABILITY: Record<DealStage, number> = {
  inquiry: 0.1,
  talking: 0.3,
  quoted: 0.5,
  won: 1,
  delivering: 1,
  invoiced: 1,
  paid: 1,
  lost: 0
};

/** 案件の粗利見込み（金額 - 直接費）。金額未定はnull。 */
export function grossProfitYen(deal: Deal): number | null {
  if (deal.amountYen === null) return null;
  return deal.amountYen - deal.costYen;
}

/** その案件で実際に受け取った金額 */
export function receivedYen(deal: Deal, moneyEntries: MoneyEntry[]): number {
  return moneyEntries
    .filter((entry) => entry.dealId === deal.id && entry.kind === 'income')
    .reduce((sum, entry) => sum + entry.amountYen, 0);
}

/**
 * 未入金の残り。
 * 段階だけで判断すると、入金を記録したのに段階を進め忘れた案件が
 * いつまでも未入金として残る。実際に受け取った額を差し引いて出す。
 */
export function unpaidYen(deal: Deal, moneyEntries: MoneyEntry[] = []): number {
  if (deal.stage !== 'invoiced') return 0;
  const remaining = (deal.amountYen ?? 0) - receivedYen(deal, moneyEntries);
  return remaining > 0 ? remaining : 0;
}
