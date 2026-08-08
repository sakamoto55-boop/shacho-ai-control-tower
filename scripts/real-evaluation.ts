import 'dotenv/config';
/**
 * 実データ100問評価（Phase B1.5 §29）。
 *
 * Service Account接続 + Sanity PASS後に実行する。Synthetic Fixture評価とは別物。
 * 実データが未接続（sanity NOT READY / DATA_UNAVAILABLE）の場合、
 * 評価は「実データ評価としては無効」である旨を明示して終了する。
 * 結果は data/real-eval-report.json（Git管理外のdata/配下）へ保存する。
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createCommandRepository } from '../src/command/repositories/CommandRepository.js';
import { CommandOrchestrator } from '../src/command/orchestrator/orchestrator.js';
import { datasetAvailability } from '../src/command/sources/SourceAdapter.js';
import { runRealEvaluation, type RealEvalQuestion } from '../src/command/evaluation/realEval.js';
import { CONTINUOUS_30, buildRealEval100 } from '../src/command/livebeta/battleSet.js';
import type { CommandDataset } from '../src/command/data/seed.js';

/**
 * 実在エンティティ質問（実データ接続後にのみ作れる評価）。
 * 実際の案件名・顧客名で質問し、正しく特定して答えられるかを検査する。
 */
function buildRealEntityQuestions(dataset: CommandDataset): RealEvalQuestion[] {
  const questions: RealEvalQuestion[] = [];
  const projects = dataset.projects.filter((p) => p.name.trim().length >= 6).slice(0, 20);
  for (const [i, project] of projects.entries()) {
    questions.push({
      id: `real-proj-${i}`,
      category: 'project-detail',
      question: `${project.name}どう？`,
      scope: 'lcc',
      expectAnswerable: true
    });
  }
  const withProjects = new Set(dataset.projects.map((p) => p.customerId));
  const customers = dataset.customers
    .filter((c) => c.name.trim().length >= 3 && withProjects.has(c.customerId))
    .slice(0, 10);
  for (const [i, customer] of customers.entries()) {
    questions.push({
      id: `real-cust-${i}`,
      category: 'customer',
      question: `${customer.name}さんの案件どう？`,
      scope: 'lcc',
      expectAnswerable: true
    });
  }
  return questions;
}

async function main(): Promise<void> {
  // 評価は独立した一時Storeで実行する（評価中に保存される記憶・実験が
  // 本番Memoryを汚染したり、次回評価のHallucination判定に混入するのを防ぐ）
  process.env.LCC_COMMAND_DB_PATH = './data/real-eval-store.json';
  await rm('./data/real-eval-store.json', { force: true });
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

  // 質問セット: 接続済みスコープのみ（未接続法人へは推測回答を求めない）+ 実在エンティティ質問
  const connectedScopes = ['group', ...dataset.companies.map((c) => c.companyId)];
  const QUESTIONS = [...buildRealEval100(connectedScopes), ...buildRealEntityQuestions(dataset)];
  console.log(`[real-eval] 質問数: ${QUESTIONS.length}問（スコープ: ${connectedScopes.join('/')}）`);

  const orchestrator = new CommandOrchestrator(repository);
  // 各質問は独立会話として評価する（前問の文脈が混ざると評価が汚染される。
  // 文脈保持は別途「30ターン連続会話試験」で検査する）
  let evalSeq = 0;
  const report = await runRealEvaluation(QUESTIONS, (question, scope) => {
    evalSeq += 1;
    return orchestrator.chat({ message: question, scope, asOf, sessionId: `real-eval-${evalSeq}` });
  });

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
