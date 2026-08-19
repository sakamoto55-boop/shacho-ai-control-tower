import {
  checkStall,
  DEAL_STAGE_LABELS,
  isActionDueToday,
  isActionOverdue,
  isOpenDeal,
  unpaidYen
} from '../domain/dealRules.js';
import { isReviewDue, summarizeAll } from '../domain/pillarRules.js';
import type { BriefItem, Deal, MoneyEntry, MorningBrief, Pillar, TimeEntry } from '../domain/types.js';
import { nowIso, shiftIso, todayIso } from '../utils/date.js';
import { formatYen } from '../utils/money.js';

export interface BriefInput {
  pillars: Pillar[];
  deals: Deal[];
  timeEntries: TimeEntry[];
  moneyEntries: MoneyEntry[];
}

function describeDeal(deal: Deal, pillars: Pillar[]): string {
  const pillar = pillars.find((item) => item.id === deal.pillarId);
  const amount = deal.amountYen === null ? '金額未定' : formatYen(deal.amountYen);
  return `${deal.title}（${deal.clientName || '相手未記入'}／${pillar?.name ?? '柱未設定'}／${DEAL_STAGE_LABELS[deal.stage]}／${amount}）`;
}

function block(item: BriefItem): string {
  return [`■ ${item.headline}`, item.fact, ...item.options.map((option) => `  - ${option}`)].join('\n');
}

/**
 * 朝に読む材料。
 *
 * 参謀なので「〜すべき」とは書かない。事実と選択肢だけを並べ、決めるのは本人に残す。
 * 一人だと迷っている時間がそのまま損失になるので、選択肢は必ず具体的な動作で書く。
 */
export function buildMorningBrief(input: BriefInput, now = new Date()): MorningBrief {
  const today = todayIso(now);
  const openDeals = input.deals.filter(isOpenDeal);

  const overdue = openDeals.filter((deal) => isActionOverdue(deal, today));
  const dueToday = openDeals.filter((deal) => isActionDueToday(deal, today));
  const stalled = openDeals
    .filter((deal) => !overdue.includes(deal) && !dueToday.includes(deal))
    .map((deal) => ({ deal, stall: checkStall(deal, today) }))
    .filter((entry) => entry.stall.stalled)
    .sort((a, b) => b.stall.idleDays - a.stall.idleDays);
  // 入金を記録済みの案件は、段階を進め忘れていても未入金に数えない
  const unpaid = input.deals
    .map((deal) => ({ deal, remaining: unpaidYen(deal, input.moneyEntries) }))
    .filter((entry) => entry.remaining > 0);
  const settledButOpen = input.deals.filter(
    (deal) => deal.stage === 'invoiced' && unpaidYen(deal, input.moneyEntries) === 0
  );
  const reviewDue = input.pillars.filter((pillar) => isReviewDue(pillar, today));

  const items: BriefItem[] = [];

  if (overdue.length > 0) {
    items.push({
      headline: `期限を過ぎた次アクション ${overdue.length}件`,
      fact: overdue
        .map((deal) => `・${describeDeal(deal, input.pillars)}\n  期限${deal.nextActionOn}／${deal.nextAction || '次アクション未記入'}`)
        .join('\n'),
      options: [
        '今日やる（`sanbo deal touch <id>` で期限を引き直す）',
        '期限を先に延ばす（`sanbo deal set <id> --due 3日後`）',
        '落とす（`sanbo deal move <id> lost`）'
      ]
    });
  }

  if (dueToday.length > 0) {
    items.push({
      headline: `今日が期限の次アクション ${dueToday.length}件`,
      fact: dueToday
        .map((deal) => `・${describeDeal(deal, input.pillars)}\n  ${deal.nextAction || '次アクション未記入'}`)
        .join('\n'),
      options: ['先にこれを片付ける', '午後に回す（時間を確保しておく）']
    });
  }

  if (stalled.length > 0) {
    items.push({
      headline: `連絡が途切れている案件 ${stalled.length}件`,
      fact: stalled
        .slice(0, 5)
        .map(
          ({ deal, stall }) =>
            `・${describeDeal(deal, input.pillars)}\n  ${stall.idleDays}日動いていない（この段階の目安は${stall.limitDays}日）`
        )
        .join('\n'),
      options: [
        '一言だけ連絡を入れる（`sanbo draft reply` で下書きを作る）',
        '見込みなしとして閉じる（`sanbo deal move <id> lost`）'
      ]
    });
  }

  if (unpaid.length > 0) {
    const total = unpaid.reduce((sum, entry) => sum + entry.remaining, 0);
    items.push({
      headline: `請求済みで未入金 ${unpaid.length}件（${formatYen(total)}）`,
      fact: unpaid
        .map(
          ({ deal, remaining }) =>
            `・${describeDeal(deal, input.pillars)}／残り${formatYen(remaining)}／最終更新${deal.lastTouchedOn}`
        )
        .join('\n'),
      options: ['入金を確認して記録する（`sanbo money in`）', '入金予定日を相手に確認する']
    });
  }

  if (settledButOpen.length > 0) {
    items.push({
      headline: `入金は済んでいるが請求済みのままの案件 ${settledButOpen.length}件`,
      fact: settledButOpen.map((deal) => `・${describeDeal(deal, input.pillars)}`).join('\n'),
      options: ['段階を進めて閉じる（`sanbo deal move <id> paid`）', '一部入金なら金額を直す（`sanbo deal set <id> --amount ...`）']
    });
  }

  if (reviewDue.length > 0) {
    const summaries = summarizeAll(
      reviewDue,
      input.deals,
      input.timeEntries,
      input.moneyEntries,
      { from: shiftIso(today, -30), to: today }
    );
    items.push({
      headline: `見直し日が来た柱 ${reviewDue.length}本`,
      fact: summaries
        .map((summary) => {
          const target = summary.pillar.targetMonthlyProfitYen;
          const targetText = target === null ? '基準未設定' : `基準${formatYen(target)}`;
          return `・${summary.pillar.name}／直近30日の粗利${formatYen(summary.profitYen)}（${targetText}）`;
        })
        .join('\n'),
      options: [
        '続ける（`sanbo pillar set <id> --review 30日後` で次の判断日を置く）',
        '主力にする（`sanbo pillar set <id> --status active`）',
        'やめる（`sanbo pillar set <id> --status dropped`）'
      ]
    });
  }

  if (items.length === 0) {
    items.push({
      headline: '期限も放置案件もありません',
      fact: `進行中の案件は${openDeals.length}件です。`,
      options: [
        '前に進める仕事に時間を使う（営業・発信）',
        '数字を見る（`sanbo review`）'
      ]
    });
  }

  const text = [
    `【AI参謀｜朝の材料】${today}`,
    '決めるのはあなたです。ここには事実と選べる手だけ置きます。',
    '',
    items.map(block).join('\n\n'),
    ''
  ].join('\n');

  return {
    date: today,
    generatedAt: nowIso(),
    text,
    items,
    counts: {
      dueToday: dueToday.length,
      overdue: overdue.length,
      stalled: stalled.length,
      unpaid: unpaid.length,
      reviewDuePillars: reviewDue.length
    }
  };
}
