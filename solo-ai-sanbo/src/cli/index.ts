import 'dotenv/config';
import { parseArgs } from './args.js';
import { dealAdd, dealList, dealMove, dealSet, dealTouch } from './commands/deal.js';
import { pillarAdd, pillarList, pillarSet } from './commands/pillar.js';
import { moneyAdd, timeAdd, timeList } from './commands/record.js';
import { brief, draft, review } from './commands/report.js';
import { HELP_TEXT } from './help.js';
import { CliError } from './resolve.js';
import { Store } from '../repositories/Store.js';

type Handler = (store: Store, args: ReturnType<typeof parseArgs>) => Promise<string>;

/**
 * `<グループ> <動作>` の2語で引く表。
 * 迷ったら `sanbo` だけ打てばヘルプが出る、という状態を保つ。
 */
const ROUTES: Record<string, Handler> = {
  'pillar add': (store, args) => pillarAdd(store, args),
  'pillar list': (store) => pillarList(store),
  'pillar set': (store, args) => pillarSet(store, args),
  'deal add': (store, args) => dealAdd(store, args),
  'deal list': (store, args) => dealList(store, args),
  'deal move': (store, args) => dealMove(store, args),
  'deal touch': (store, args) => dealTouch(store, args),
  'deal set': (store, args) => dealSet(store, args),
  'time list': (store, args) => timeList(store, args),
  'money in': (store, args) => moneyAdd(store, args, 'income'),
  'money out': (store, args) => moneyAdd(store, args, 'expense')
};

export async function runCli(argv: string[], store = new Store()): Promise<string> {
  const [first, second, ...rest] = argv;

  if (!first || first === 'help' || first === '--help' || first === '-h') {
    return HELP_TEXT;
  }

  if (first === 'brief') return brief(store);
  if (first === 'review') return review(store, parseArgs([second, ...rest].filter(Boolean)));
  if (first === 'draft') return draft(store, parseArgs([second, ...rest].filter(Boolean)));
  // `sanbo time 90 --pillar 解体` を通すため、time listだけを分岐させる
  if (first === 'time' && second !== 'list') {
    return timeAdd(store, parseArgs([second, ...rest].filter(Boolean)));
  }

  const route = ROUTES[`${first} ${second}`];
  if (!route) {
    throw new CliError(`知らないコマンドです: ${[first, second].filter(Boolean).join(' ')}\n\n${HELP_TEXT}`);
  }
  return route(store, parseArgs(rest));
}

async function main(): Promise<void> {
  try {
    const output = await runCli(process.argv.slice(2));
    console.log(output);
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
