export interface ParsedArgs {
  /** フラグを除いた位置引数 */
  positional: string[];
  flags: Record<string, string | true>;
}

/**
 * `--key value` と `--flag` だけを解釈する小さなパーサ。
 * 毎日打つものなので、依存を増やさず挙動を追えるようにしておく。
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }

  return { positional, flags };
}

export function flagString(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags[key];
  return typeof value === 'string' ? value : undefined;
}

export function flagBool(args: ParsedArgs, key: string): boolean {
  return args.flags[key] !== undefined;
}
