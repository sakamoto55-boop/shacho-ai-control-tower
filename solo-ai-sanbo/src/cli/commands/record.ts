import { randomUUID } from 'node:crypto';
import type { MoneyEntry, TimeCategory, TimeEntry } from '../../domain/types.js';
import { Store } from '../../repositories/Store.js';
import { daysBetween, nowIso, parseDateInput, todayIso } from '../../utils/date.js';
import { formatHours, formatYen, parseYen } from '../../utils/money.js';
import { flagString, type ParsedArgs } from '../args.js';
import { CliError, resolveDeal, resolvePillar, shortId } from '../resolve.js';

const CATEGORIES: TimeCategory[] = ['sales', 'delivery', 'content', 'admin', 'learning'];

const CATEGORY_LABELS: Record<TimeCategory, string> = {
  sales: '営業',
  delivery: '実作業',
  content: '発信',
  admin: '事務',
  learning: '学習'
};

function parseCategory(value: string | undefined): TimeCategory {
  if (value === undefined) return 'delivery';
  if ((CATEGORIES as string[]).includes(value)) return value as TimeCategory;
  throw new CliError(`--cat は ${CATEGORIES.join(' / ')} のどれかです: ${value}`);
}

function parseDate(value: string | undefined): string {
  const date = parseDateInput(value ?? '今日');
  if (date === null) throw new CliError(`--date の日付が読めません: ${value}`);
  return date;
}

async function resolveTargets(store: Store, args: ParsedArgs) {
  const dealQuery = flagString(args, 'deal');
  const pillarQuery = flagString(args, 'pillar');

  if (dealQuery) {
    // 案件を指定したなら柱は案件から決まる。二重に打たせない。
    const deal = resolveDeal(await store.listDeals(), dealQuery);
    return { pillarId: deal.pillarId, dealId: deal.id, label: deal.title };
  }
  if (!pillarQuery) {
    throw new CliError('--pillar か --deal のどちらかを指定してください。');
  }
  const pillar = resolvePillar(await store.listPillars(), pillarQuery);
  return { pillarId: pillar.id, dealId: null, label: pillar.name };
}

export async function timeAdd(store: Store, args: ParsedArgs): Promise<string> {
  const [rawMinutes] = args.positional;
  const minutes = Number(rawMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new CliError('分数を入れてください。例: sanbo time 90 --pillar 解体 --cat delivery');
  }

  const target = await resolveTargets(store, args);
  const entry: TimeEntry = {
    id: randomUUID(),
    pillarId: target.pillarId,
    dealId: target.dealId,
    date: parseDate(flagString(args, 'date')),
    minutes: Math.round(minutes),
    category: parseCategory(flagString(args, 'cat')),
    note: flagString(args, 'note') ?? '',
    createdAt: nowIso()
  };
  await store.addTimeEntry(entry);

  return `記録しました: ${entry.date} ${formatHours(entry.minutes / 60)} ${CATEGORY_LABELS[entry.category]}／${target.label}`;
}

export async function timeList(store: Store, args: ParsedArgs): Promise<string> {
  const days = Number(flagString(args, 'days') ?? 7);
  const today = todayIso();
  const [entries, pillars] = await Promise.all([store.listTimeEntries(), store.listPillars()]);
  const recent = entries
    .filter((entry) => daysBetween(entry.date, today) < days)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (recent.length === 0) return `直近${days}日の時間の記録はありません。`;

  const total = recent.reduce((sum, entry) => sum + entry.minutes, 0);
  const lines = recent.map((entry) => {
    const pillar = pillars.find((item) => item.id === entry.pillarId);
    return `${entry.date}  ${String(Math.round(entry.minutes)).padStart(4)}分  ${CATEGORY_LABELS[entry.category]}  ${pillar?.name ?? '柱不明'}${entry.note ? `  ${entry.note}` : ''}`;
  });
  return [...lines, '', `直近${days}日の合計: ${formatHours(total / 60)}`].join('\n');
}

export async function moneyAdd(
  store: Store,
  args: ParsedArgs,
  kind: 'income' | 'expense'
): Promise<string> {
  const [rawAmount] = args.positional;
  if (!rawAmount) {
    throw new CliError(`金額を入れてください。例: sanbo money ${kind === 'income' ? 'in' : 'out'} 30万 --pillar 解体`);
  }
  const amountYen = parseYen(rawAmount);
  if (amountYen === null || amountYen <= 0) throw new CliError(`金額が読めません: ${rawAmount}`);

  const target = await resolveTargets(store, args);
  const entry: MoneyEntry = {
    id: randomUUID(),
    pillarId: target.pillarId,
    dealId: target.dealId,
    date: parseDate(flagString(args, 'date')),
    kind,
    amountYen,
    label: flagString(args, 'label') ?? '',
    createdAt: nowIso()
  };
  await store.addMoneyEntry(entry);

  const word = kind === 'income' ? '入金' : '支出';
  const lines = [`記録しました: ${entry.date} ${word} ${formatYen(amountYen)}／${target.label}`];
  if (kind === 'income' && target.dealId) {
    lines.push(`  案件も進めるなら: sanbo deal move ${shortId(target.dealId)} paid`);
  }
  return lines.join('\n');
}
