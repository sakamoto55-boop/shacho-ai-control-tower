import { randomUUID } from 'node:crypto';
import { checkStall, DEAL_STAGE_LABELS, isOpenDeal } from '../../domain/dealRules.js';
import type { Deal, DealStage } from '../../domain/types.js';
import { Store } from '../../repositories/Store.js';
import { nowIso, parseDateInput, todayIso } from '../../utils/date.js';
import { formatYen, parseYen } from '../../utils/money.js';
import { flagBool, flagString, type ParsedArgs } from '../args.js';
import { CliError, resolveDeal, resolvePillar, shortId } from '../resolve.js';

const STAGES: DealStage[] = [
  'inquiry',
  'talking',
  'quoted',
  'won',
  'delivering',
  'invoiced',
  'paid',
  'lost'
];

function parseAmount(value: string | undefined, label: string): number | null {
  if (value === undefined) return null;
  const yen = parseYen(value);
  if (yen === null) throw new CliError(`${label} の金額が読めません: ${value}`);
  return yen;
}

function parseDue(value: string | undefined): string | null {
  if (value === undefined) return null;
  const date = parseDateInput(value);
  if (date === null) throw new CliError(`--due の日付が読めません: ${value}`);
  return date;
}

export async function dealAdd(store: Store, args: ParsedArgs): Promise<string> {
  const title = args.positional.join(' ').trim();
  if (title === '') throw new CliError('案件名を入れてください。例: sanbo deal add 空き家解体 --pillar 解体');

  const pillarQuery = flagString(args, 'pillar');
  if (!pillarQuery) throw new CliError('--pillar でどの柱の案件かを指定してください。');
  const pillar = resolvePillar(await store.listPillars(), pillarQuery);

  const now = nowIso();
  const today = todayIso();
  const deal: Deal = {
    id: randomUUID(),
    pillarId: pillar.id,
    title,
    clientName: flagString(args, 'client') ?? '',
    contact: flagString(args, 'contact') ?? '',
    stage: 'inquiry',
    amountYen: parseAmount(flagString(args, 'amount'), '--amount'),
    costYen: parseAmount(flagString(args, 'cost'), '--cost') ?? 0,
    nextAction: flagString(args, 'next') ?? '',
    nextActionOn: parseDue(flagString(args, 'due')),
    lastTouchedOn: today,
    memo: flagString(args, 'memo') ?? '',
    createdAt: now,
    updatedAt: now
  };
  await store.addDeal(deal);

  const lines = [`案件を追加しました: ${deal.title} [${shortId(deal.id)}]／${pillar.name}`];
  if (deal.nextActionOn === null) {
    // 期限のない案件は朝の材料に出てこないので、そのまま忘れる。
    lines.push('  次アクションの期限がありません。`--due 明日` を付けると、朝の材料に出ます。');
  }
  return lines.join('\n');
}

export async function dealList(store: Store, args: ParsedArgs): Promise<string> {
  const [deals, pillars] = await Promise.all([store.listDeals(), store.listPillars()]);
  const showAll = flagBool(args, 'all');
  const target = showAll ? deals : deals.filter(isOpenDeal);
  if (target.length === 0) {
    return showAll ? '案件がまだありません。' : '進行中の案件はありません。（終わった案件も見るなら --all）';
  }

  const today = todayIso();
  return target
    .slice()
    .sort((a, b) => (a.nextActionOn ?? '9999').localeCompare(b.nextActionOn ?? '9999'))
    .map((deal) => {
      const pillar = pillars.find((item) => item.id === deal.pillarId);
      const amount = deal.amountYen === null ? '金額未定' : formatYen(deal.amountYen);
      const due = deal.nextActionOn ? `期限${deal.nextActionOn}` : '期限なし';
      const stall = checkStall(deal, today);
      const stallMark = stall.stalled ? ` ⚠${stall.idleDays}日動いていません` : '';
      return [
        `[${shortId(deal.id)}] ${deal.title}／${deal.clientName || '相手未記入'}（${pillar?.name ?? '柱不明'}）`,
        `        ${DEAL_STAGE_LABELS[deal.stage]}／${amount}／${due}${stallMark}`,
        deal.nextAction ? `        次: ${deal.nextAction}` : '        次アクション未記入'
      ].join('\n');
    })
    .join('\n');
}

export async function dealMove(store: Store, args: ParsedArgs): Promise<string> {
  const [query, stage] = args.positional;
  if (!query || !stage) {
    throw new CliError(`使い方: sanbo deal move <案件> <${STAGES.join('|')}>`);
  }
  if (!(STAGES as string[]).includes(stage)) {
    throw new CliError(`段階は ${STAGES.join(' / ')} のどれかです: ${stage}`);
  }

  const deal = resolveDeal(await store.listDeals(), query);
  const updated = await store.updateDeal(deal.id, {
    stage: stage as DealStage,
    lastTouchedOn: todayIso()
  });

  const lines = [`${updated?.title}: ${DEAL_STAGE_LABELS[deal.stage]} → ${DEAL_STAGE_LABELS[stage as DealStage]}`];
  if (stage === 'paid') {
    // 段階を進めただけでは帳簿に載らない。時給の計算が狂うので必ず促す。
    lines.push(
      `  入金の記録はまだです: sanbo money in ${updated?.amountYen ?? 0} --pillar ${shortId(deal.pillarId)} --deal ${shortId(deal.id)}`
    );
  }
  if (stage === 'invoiced') {
    lines.push('  未入金として朝の材料に出続けます。入金されたら `deal move <id> paid` に進めてください。');
  }
  return lines.join('\n');
}

export async function dealTouch(store: Store, args: ParsedArgs): Promise<string> {
  const [query] = args.positional;
  if (!query) throw new CliError('使い方: sanbo deal touch <案件> [--next "やること"] [--due 3日後]');

  const deal = resolveDeal(await store.listDeals(), query);
  const patch: Partial<Deal> = { lastTouchedOn: todayIso() };
  if (flagString(args, 'next') !== undefined) patch.nextAction = flagString(args, 'next');
  if (flagString(args, 'due') !== undefined) patch.nextActionOn = parseDue(flagString(args, 'due'));

  const updated = await store.updateDeal(deal.id, patch);
  return `動かしました: ${updated?.title}／次「${updated?.nextAction || '未記入'}」／期限${updated?.nextActionOn ?? 'なし'}`;
}

export async function dealSet(store: Store, args: ParsedArgs): Promise<string> {
  const [query] = args.positional;
  if (!query) throw new CliError('どの案件かを指定してください。');

  const deal = resolveDeal(await store.listDeals(), query);
  const patch: Partial<Deal> = {};
  if (flagString(args, 'amount') !== undefined) patch.amountYen = parseAmount(flagString(args, 'amount'), '--amount');
  if (flagString(args, 'cost') !== undefined) patch.costYen = parseAmount(flagString(args, 'cost'), '--cost') ?? 0;
  if (flagString(args, 'next') !== undefined) patch.nextAction = flagString(args, 'next');
  if (flagString(args, 'due') !== undefined) patch.nextActionOn = parseDue(flagString(args, 'due'));
  if (flagString(args, 'client') !== undefined) patch.clientName = flagString(args, 'client');
  if (flagString(args, 'contact') !== undefined) patch.contact = flagString(args, 'contact');
  if (flagString(args, 'memo') !== undefined) patch.memo = flagString(args, 'memo');

  if (Object.keys(patch).length === 0) {
    throw new CliError('変えるものがありません。--amount / --cost / --next / --due / --client / --memo などを付けてください。');
  }

  const updated = await store.updateDeal(deal.id, { ...patch, lastTouchedOn: todayIso() });
  const amount = updated?.amountYen === null || updated === null ? '金額未定' : formatYen(updated.amountYen ?? 0);
  return `更新しました: ${updated?.title}／${amount}／期限${updated?.nextActionOn ?? 'なし'}`;
}
