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
import {
  HALLUCINATION_PROBES,
  runRealEvaluation,
  type RealEvalQuestion
} from '../src/command/evaluation/realEval.js';

/** 実データ用の質問セット（カテゴリ別）。実在エンティティ依存の質問は接続後に追記する */
const QUESTIONS: RealEvalQuestion[] = [
  { id: 'r-sales-1', category: 'sales', question: '今月どう？', scope: 'lcc', expectAnswerable: true },
  { id: 'r-cash-1', category: 'cash', question: '現金大丈夫？', scope: 'lcc', expectAnswerable: false },
  { id: 'r-risk-1', category: 'risk', question: '一番危ない案件は？', scope: 'lcc', expectAnswerable: true },
  { id: 'r-inv-1', category: 'invoice', question: '請求漏れてない？', scope: 'lcc', expectAnswerable: true },
  { id: 'r-ops-1', category: 'operations', question: '今日の現場は？', scope: 'lcc', expectAnswerable: false },
  { id: 'r-ops-2', category: 'operations', question: '昨日誰がどこ行った？', scope: 'lcc', expectAnswerable: false },
  ...HALLUCINATION_PROBES
];

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
  await mkdir('data', { recursive: true });
  await writeFile('data/real-eval-report.json', JSON.stringify(report, null, 2), 'utf8');
  console.log(
    `[real-eval] ${report.passed}/${report.total} 合格 / Hallucination ${report.hallucinationFailures}/${report.hallucinationProbes} 失敗`
  );
  if (report.hallucinationFailures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[real-eval] 失敗:', error);
  process.exitCode = 1;
});
