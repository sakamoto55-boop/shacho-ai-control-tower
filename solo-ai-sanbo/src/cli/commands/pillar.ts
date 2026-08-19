import { randomUUID } from 'node:crypto';
import { PILLAR_KIND_LABELS, summarizeAll } from '../../domain/pillarRules.js';
import type { Pillar, PillarKind, PillarStatus } from '../../domain/types.js';
import { Store } from '../../repositories/Store.js';
import { nowIso, parseDateInput, todayIso } from '../../utils/date.js';
import { formatHourly, formatYen, parseYen } from '../../utils/money.js';
import { flagString, type ParsedArgs } from '../args.js';
import { CliError, resolvePillar, shortId } from '../resolve.js';

const KINDS: PillarKind[] = ['service', 'content', 'contract', 'other'];
const STATUSES: PillarStatus[] = ['testing', 'active', 'paused', 'dropped'];

function parseKind(value: string | undefined): PillarKind {
  if (value === undefined) return 'other';
  if ((KINDS as string[]).includes(value)) return value as PillarKind;
  throw new CliError(`--kind は ${KINDS.join(' / ')} のどれかです: ${value}`);
}

function parseReview(value: string | undefined): string | null {
  if (value === undefined) return null;
  const date = parseDateInput(value);
  if (date === null) throw new CliError(`--review の日付が読めません: ${value}`);
  return date;
}

function parseTarget(value: string | undefined): number | null {
  if (value === undefined) return null;
  const yen = parseYen(value);
  if (yen === null) throw new CliError(`--target の金額が読めません: ${value}`);
  return yen;
}

export async function pillarAdd(store: Store, args: ParsedArgs): Promise<string> {
  const name = args.positional.join(' ').trim();
  if (name === '') {
    throw new CliError('柱の名前を入れてください。例: sanbo pillar add 解体の個人受注 --kind service');
  }

  const now = nowIso();
  const pillar: Pillar = {
    id: randomUUID(),
    name,
    kind: parseKind(flagString(args, 'kind')),
    status: 'testing',
    startedOn: parseDateInput(flagString(args, 'start') ?? '今日') ?? todayIso(),
    reviewOn: parseReview(flagString(args, 'review')),
    targetMonthlyProfitYen: parseTarget(flagString(args, 'target')),
    note: flagString(args, 'note') ?? '',
    createdAt: now,
    updatedAt: now
  };
  await store.addPillar(pillar);

  const lines = [`柱を追加しました: ${pillar.name} [${shortId(pillar.id)}]`];
  if (pillar.reviewOn === null) {
    // 判断日を決めない柱は惰性で続いてしまう。ここで一度だけ促す。
    lines.push('  見直し日が未設定です。`--review 30日後` を付けると、その日に参謀が判断を促します。');
  }
  if (pillar.targetMonthlyProfitYen === null) {
    lines.push('  撤退基準（--target）が未設定です。先に決めておくと、あとで迷いません。');
  }
  return lines.join('\n');
}

export async function pillarList(store: Store): Promise<string> {
  const [pillars, deals, timeEntries, moneyEntries] = await Promise.all([
    store.listPillars(),
    store.listDeals(),
    store.listTimeEntries(),
    store.listMoneyEntries()
  ]);
  if (pillars.length === 0) {
    return '柱がまだありません。\n  例: sanbo pillar add 解体の個人受注 --kind service --review 30日後 --target 30万';
  }

  const summaries = summarizeAll(pillars, deals, timeEntries, moneyEntries);
  return summaries
    .map((summary) => {
      const pillar = summary.pillar;
      const review = pillar.reviewOn ? `見直し${pillar.reviewOn}` : '見直し日なし';
      const target = pillar.targetMonthlyProfitYen
        ? `基準${formatYen(pillar.targetMonthlyProfitYen)}`
        : '基準なし';
      return [
        `[${shortId(pillar.id)}] ${pillar.name}（${PILLAR_KIND_LABELS[pillar.kind]}／${pillar.status}）`,
        `        累計 粗利${formatYen(summary.profitYen)}／${formatHourly(summary.profitPerHourYen)}／進行中${summary.openDealCount}件`,
        `        ${review}／${target}`
      ].join('\n');
    })
    .join('\n');
}

export async function pillarSet(store: Store, args: ParsedArgs): Promise<string> {
  const [query] = args.positional;
  if (!query) throw new CliError('どの柱かを指定してください。例: sanbo pillar set 解体 --status active');

  const pillar = resolvePillar(await store.listPillars(), query);
  const patch: Partial<Pillar> = {};

  const status = flagString(args, 'status');
  if (status !== undefined) {
    if (!(STATUSES as string[]).includes(status)) {
      throw new CliError(`--status は ${STATUSES.join(' / ')} のどれかです: ${status}`);
    }
    patch.status = status as PillarStatus;
  }
  if (flagString(args, 'review') !== undefined) patch.reviewOn = parseReview(flagString(args, 'review'));
  if (flagString(args, 'target') !== undefined) {
    patch.targetMonthlyProfitYen = parseTarget(flagString(args, 'target'));
  }
  if (flagString(args, 'name') !== undefined) patch.name = flagString(args, 'name');
  if (flagString(args, 'note') !== undefined) patch.note = flagString(args, 'note');

  if (Object.keys(patch).length === 0) {
    throw new CliError('変えるものがありません。--status / --review / --target / --name / --note のどれかを付けてください。');
  }

  const updated = await store.updatePillar(pillar.id, patch);
  return `更新しました: ${updated?.name}（${updated?.status}／見直し${updated?.reviewOn ?? 'なし'}）`;
}
