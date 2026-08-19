import { createProvider } from '../../ai/createProvider.js';
import type { DraftKind, DraftRequest } from '../../domain/types.js';
import { buildMorningBrief, type BriefInput } from '../../reports/morningBrief.js';
import { buildWeeklyReview } from '../../reports/weeklyReview.js';
import { Store } from '../../repositories/Store.js';
import { flagString, type ParsedArgs } from '../args.js';
import { CliError, resolvePillar } from '../resolve.js';

async function loadInput(store: Store): Promise<BriefInput> {
  const db = await store.load();
  return {
    pillars: db.pillars,
    deals: db.deals,
    timeEntries: db.timeEntries,
    moneyEntries: db.moneyEntries
  };
}

export async function brief(store: Store): Promise<string> {
  return buildMorningBrief(await loadInput(store)).text;
}

export async function review(store: Store, args: ParsedArgs): Promise<string> {
  const days = Number(flagString(args, 'days') ?? 7);
  if (!Number.isFinite(days) || days < 1) throw new CliError(`--days が読めません: ${flagString(args, 'days')}`);
  return buildWeeklyReview(await loadInput(store), new Date(), Math.round(days)).text;
}

const DRAFT_KINDS: DraftKind[] = ['reply', 'estimate', 'content'];

export async function draft(store: Store, args: ParsedArgs): Promise<string> {
  const [kind, ...rest] = args.positional;
  if (!kind || !(DRAFT_KINDS as string[]).includes(kind)) {
    throw new CliError(`使い方: sanbo draft <${DRAFT_KINDS.join('|')}> <内容>`);
  }
  const input = rest.join(' ').trim();
  if (input === '') throw new CliError('下書きの元になる内容を入れてください。');

  const request: DraftRequest = {
    kind: kind as DraftKind,
    input,
    context: flagString(args, 'context')
  };

  const pillarQuery = flagString(args, 'pillar');
  if (pillarQuery) {
    request.pillarKind = resolvePillar(await store.listPillars(), pillarQuery).kind;
  }

  const result = await createProvider().draft(request);

  const sections = ['--- 下書き（ここから）---', result.text, '--- 下書き（ここまで）---'];
  if (result.leftToYou.length > 0) {
    sections.push('', '■ AIが決めなかったところ', ...result.leftToYou.map((item) => `  - ${item}`));
  }
  if (result.checkBeforeSending.length > 0) {
    sections.push('', '■ 出す前に自分で確かめること', ...result.checkBeforeSending.map((item) => `  - ${item}`));
  }
  sections.push('', '送信も投稿もしていません。読んで直してから、自分で出してください。');
  return sections.join('\n');
}
