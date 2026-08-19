import type { Deal, Pillar } from '../domain/types.js';
import { findByIdPrefix } from '../repositories/Store.js';

export class CliError extends Error {}

/** 短いIDでも名前の一部でも指せるようにする。毎日打つのにUUIDは無理があるため。 */
export function resolvePillar(pillars: Pillar[], query: string): Pillar {
  const byId = findByIdPrefix(pillars, query);
  if (byId) return byId;

  const matched = pillars.filter((pillar) => pillar.name.includes(query));
  if (matched.length === 1) return matched[0];
  if (matched.length === 0) {
    throw new CliError(`柱が見つかりません: ${query}\n  \`sanbo pillar list\` で一覧を確認してください。`);
  }
  throw new CliError(
    `柱の指定があいまいです: ${query}\n  候補: ${matched.map((pillar) => pillar.name).join(' / ')}`
  );
}

export function resolveDeal(deals: Deal[], query: string): Deal {
  const byId = findByIdPrefix(deals, query);
  if (byId) return byId;

  const matched = deals.filter(
    (deal) => deal.title.includes(query) || deal.clientName.includes(query)
  );
  if (matched.length === 1) return matched[0];
  if (matched.length === 0) {
    throw new CliError(`案件が見つかりません: ${query}\n  \`sanbo deal list\` で一覧を確認してください。`);
  }
  throw new CliError(
    `案件の指定があいまいです: ${query}\n  候補: ${matched.map((deal) => deal.title).join(' / ')}`
  );
}

/** 表示用の短いID。先頭6文字あれば一人分の記録では衝突しない。 */
export function shortId(id: string): string {
  return id.slice(0, 6);
}
