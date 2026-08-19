import {
  isBleeding,
  judgeAgainstTarget,
  minHourlyYen,
  PILLAR_KIND_LABELS,
  rankByHourly,
  summarizeAll
} from '../domain/pillarRules.js';
import type { BriefItem, PillarSummary, TimeCategory, WeeklyReview } from '../domain/types.js';
import type { BriefInput } from './morningBrief.js';
import { nowIso, shiftIso, todayIso, withinRange } from '../utils/date.js';
import { formatHourly, formatHours, formatYen } from '../utils/money.js';

const TIME_CATEGORY_LABELS: Record<TimeCategory, string> = {
  sales: '営業',
  delivery: '実作業',
  content: '発信',
  admin: '事務',
  learning: '学習'
};

/** 直接お金につながる時間。ここが薄い週は翌週の売上が落ちる。 */
const REVENUE_FACING: TimeCategory[] = ['sales', 'delivery', 'content'];

function describeSummary(summary: PillarSummary): string {
  const kind = PILLAR_KIND_LABELS[summary.pillar.kind];
  return [
    `・${summary.pillar.name}（${kind}／${summary.pillar.status}）`,
    `    時間 ${formatHours(summary.hours)}／粗利 ${formatYen(summary.profitYen)}／${formatHourly(summary.profitPerHourYen)}`,
    `    進行中 ${summary.openDealCount}件（期待値 ${formatYen(summary.pipelineYen)}）／未入金 ${formatYen(summary.unpaidYen)}`
  ].join('\n');
}

function block(item: BriefItem): string {
  return [`■ ${item.headline}`, item.fact, ...item.options.map((option) => `  - ${option}`)].join('\n');
}

/**
 * 週に一度、柱を数字で並べる。
 *
 * 何で稼ぐかが決まっていない段階では、これが一番効く。
 * 「どれが儲かりそうか」を気分で決めず、時間あたりの粗利で比べられるようにする。
 */
export function buildWeeklyReview(input: BriefInput, now = new Date(), days = 7): WeeklyReview {
  const to = todayIso(now);
  const from = shiftIso(to, -(days - 1));
  const range = { from, to };

  const summaries = summarizeAll(
    input.pillars.filter((pillar) => pillar.status !== 'dropped'),
    input.deals,
    input.timeEntries,
    input.moneyEntries,
    range
  );
  const ranked = rankByHourly(summaries);
  const items: BriefItem[] = [];

  const totalHours = summaries.reduce((sum, summary) => sum + summary.hours, 0);
  const totalProfit = summaries.reduce((sum, summary) => sum + summary.profitYen, 0);

  const withHourly = ranked.filter((summary) => summary.profitPerHourYen !== null);
  if (withHourly.length >= 2) {
    const best = withHourly[0];
    const worst = withHourly[withHourly.length - 1];
    items.push({
      headline: '時間あたりで見ると差が出ています',
      fact: [
        `一番高い: ${best.pillar.name} ${formatHourly(best.profitPerHourYen)}`,
        `一番低い: ${worst.pillar.name} ${formatHourly(worst.profitPerHourYen)}`
      ].join('\n'),
      options: [
        `${best.pillar.name}に来週の時間を寄せる`,
        `${worst.pillar.name}の単価か進め方を変える`,
        `${worst.pillar.name}を止めて時間を空ける`,
        '判断材料が足りないので、もう1週分ためる'
      ]
    });
  }

  const bleeding = summaries.filter((summary) => isBleeding(summary));
  if (bleeding.length > 0) {
    items.push({
      headline: `時間を使ったのに粗利が出ていない柱 ${bleeding.length}本`,
      fact: bleeding
        .map((summary) => `・${summary.pillar.name}／${formatHours(summary.hours)}使って粗利 ${formatYen(summary.profitYen)}`)
        .join('\n'),
      options: [
        '仕込み期間だと割り切って、いつまで続けるかを決める（`sanbo pillar set <id> --review 30日後`）',
        '無料の作業が混ざっていないか、時間の記録を見る（`sanbo time list`）',
        '止める（`sanbo pillar set <id> --status paused`）'
      ]
    });
  }

  const belowMin = withHourly.filter(
    (summary) => (summary.profitPerHourYen ?? 0) > 0 && (summary.profitPerHourYen ?? 0) < minHourlyYen()
  );
  if (belowMin.length > 0) {
    items.push({
      headline: `決めた時給（${minHourlyYen().toLocaleString('ja-JP')}円/時）を下回っている柱`,
      fact: belowMin
        .map((summary) => `・${summary.pillar.name}／${formatHourly(summary.profitPerHourYen)}`)
        .join('\n'),
      options: ['単価を上げる', '作業時間を削る（外注・手順の見直し）', '受ける案件を選ぶ']
    });
  }

  const missed = summaries.filter((summary) => judgeAgainstTarget(summary) === 'missed');
  if (missed.length > 0) {
    items.push({
      headline: `自分で決めた基準に届いていない柱 ${missed.length}本`,
      fact: missed
        .map(
          (summary) =>
            `・${summary.pillar.name}／粗利 ${formatYen(summary.profitYen)}（基準 ${formatYen(summary.pillar.targetMonthlyProfitYen ?? 0)}）`
        )
        .join('\n'),
      options: ['基準が高すぎたので直す', '打ち手を変えてもう一度試す', '基準どおり撤退する']
    });
  }

  const weekTime = input.timeEntries.filter((entry) => withinRange(entry.date, range));
  const byCategory = new Map<TimeCategory, number>();
  for (const entry of weekTime) {
    byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + entry.minutes);
  }
  const revenueMinutes = REVENUE_FACING.reduce((sum, key) => sum + (byCategory.get(key) ?? 0), 0);
  const allMinutes = [...byCategory.values()].reduce((sum, value) => sum + value, 0);
  if (allMinutes > 0) {
    const ratio = Math.round((revenueMinutes / allMinutes) * 100);
    items.push({
      headline: `お金につながる時間は全体の${ratio}%`,
      fact: [...byCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([category, minutes]) => `・${TIME_CATEGORY_LABELS[category]} ${formatHours(minutes / 60)}`)
        .join('\n'),
      options:
        ratio < 50
          ? ['事務・学習を減らす日を決める', '事務をまとめて片付ける日を作る', '今はこれでよいと決める']
          : ['この配分を来週も保つ', '実作業に寄りすぎていないか、営業の時間を確保する']
    });
  }

  if (items.length === 0) {
    items.push({
      headline: 'まだ判断できるだけの記録がありません',
      fact: '時間とお金の記録が足りません。',
      options: [
        '毎日の終わりに `sanbo time` で1行だけ記録する',
        '入金と支出が出たら `sanbo money` で記録する'
      ]
    });
  }

  const text = [
    `【AI参謀｜週の数字】${from} 〜 ${to}`,
    `合計 ${formatHours(totalHours)}／粗利 ${formatYen(totalProfit)}`,
    '',
    '--- 柱ごとの成績（時給の高い順） ---',
    ranked.length > 0 ? ranked.map(describeSummary).join('\n') : 'まだ柱が登録されていません。',
    '',
    '--- 気づいたこと ---',
    items.map(block).join('\n\n'),
    '',
    '数字の読み方も、次の一手も、決めるのはあなたです。',
    ''
  ].join('\n');

  return { from, to, generatedAt: nowIso(), text, summaries: ranked, items };
}
