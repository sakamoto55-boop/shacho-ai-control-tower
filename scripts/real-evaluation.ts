import 'dotenv/config';
/**
 * 実データ100問評価（Phase B1.5 §29）。
 *
 * Service Account接続 + Sanity PASS後に実行する。Synthetic Fixture評価とは別物。
 * 実データが未接続（sanity NOT READY / DATA_UNAVAILABLE）の場合、
 * 評価は「実データ評価としては無効」である旨を明示して終了する。
 * 結果は data/real-eval-report.json（Git管理外のdata/配下）へ保存する。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createCommandRepository } from '../src/command/repositories/CommandRepository.js';
import { CommandOrchestrator } from '../src/command/orchestrator/orchestrator.js';
import { datasetAvailability } from '../src/command/sources/SourceAdapter.js';
import { runRealEvaluation } from '../src/command/evaluation/realEval.js';
import { CONTINUOUS_30, buildRealEval100 } from '../src/command/livebeta/battleSet.js';

/** 実データ100問+評価セット（LIVE BETA §4。カテゴリ×スコープ + Hallucination Probes） */
const QUESTIONS = buildRealEval100();

async function main(): Promise<void> {
  const repository = createCommandRepository();
  const asOf = new Date().toISOString();
  const dataset = await repository.getDataset(asOf);
  const availability = datasetAvailability(dataset);
  console.log(`[real-eval] repository mode=${repository.mode} availability=${availability}`);
  if (repository.mode !== 'production' || availability === 'DATA_UNAVAILABLE') {
    console.log(
      '[real-eval] 実データ未接続のため、この実行は実データ評価として無効です（Synthetic評価はnpm testに含まれます）。'
    );
    console.log('[real-eval] Service Account設定 + sanity PASS後に再実行してください。');
    process.exitCode = 1;
    return;
  }

  const orchestrator = new CommandOrchestrator(repository);
  const report = await runRealEvaluation(QUESTIONS, (question, scope) =>
    orchestrator.chat({ message: question, scope, asOf, sessionId: 'real-eval' })
  );

  // 30ターン連続会話試験（LIVE BETA §4: Context Retention）
  let retained = 0;
  const continuousFailures: string[] = [];
  for (const message of CONTINUOUS_30) {
    try {
      const response = await orchestrator.chat({
        message,
        scope: 'group',
        asOf,
        sessionId: 'real-eval-continuous'
      });
      if (response.text.trim().length > 0) retained += 1;
      else continuousFailures.push(message);
    } catch (error) {
      continuousFailures.push(`${message}（${error instanceof Error ? error.message : 'error'}）`);
    }
  }

  await mkdir('data', { recursive: true });
  await writeFile(
    'data/real-eval-report.json',
    JSON.stringify({ ...report, continuous30: { total: CONTINUOUS_30.length, answered: retained, failures: continuousFailures } }, null, 2),
    'utf8'
  );
  console.log(
    `[real-eval] ${report.passed}/${report.total} 合格 / Hallucination ${report.hallucinationFailures}/${report.hallucinationProbes} 失敗`
  );
  console.log(`[real-eval] 連続会話30ターン: ${retained}/${CONTINUOUS_30.length} 応答（Context Retention）`);
  if (report.hallucinationFailures > 0 || continuousFailures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[real-eval] 失敗:', error);
  process.exitCode = 1;
});
