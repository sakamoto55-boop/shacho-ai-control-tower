import 'dotenv/config';
/**
 * サニティチェック（Phase B1 §4）: ソース側の実件数 vs Canonical取込件数の照合。
 *
 * 期待件数は config/sanity.expected.json（正本の監査ログ・シート実測で確認した値）。
 * 照合に合格するまで実データを会話へ提示しない（NOT READY のとき exit code 1）。
 */
import { readFileSync } from 'node:fs';
import { createCommandRepository } from '../src/command/repositories/CommandRepository.js';
import { evaluateSanity, type SanityExpectation } from '../src/command/sources/sanity.js';

interface ExpectedCounts {
  customers?: number;
  projects?: number;
}

async function main(): Promise<void> {
  let expected: ExpectedCounts = {};
  try {
    expected = JSON.parse(readFileSync('config/sanity.expected.json', 'utf8')) as ExpectedCounts;
  } catch {
    console.error('config/sanity.expected.json が読めません（ソース側実件数の設定が必要）');
    process.exitCode = 1;
    return;
  }

  const repository = createCommandRepository();
  const dataset = await repository.getDataset(new Date().toISOString());
  console.log(`[sanity-check] repository mode=${repository.mode}`);

  const items: SanityExpectation[] = [];
  if (expected.customers !== undefined) {
    items.push({ name: 'customers', expected: expected.customers, actual: dataset.customers.length });
  }
  if (expected.projects !== undefined) {
    items.push({ name: 'projects', expected: expected.projects, actual: dataset.projects.length });
  }

  const result = evaluateSanity(items);
  for (const line of result.lines) console.log(line);
  if (!result.ready) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[sanity-check] 失敗:', error);
  process.exitCode = 1;
});
