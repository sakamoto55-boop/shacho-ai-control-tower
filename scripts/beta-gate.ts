/**
 * LIVE BETA Gate チェック（LIVE BETA §1-§2・§20）。
 *
 * 最小起動条件（Sheets SA + 実LLM 1つ）と§20の全Gate条件を判定し、
 * 未達条件にはユーザー操作 or 実行コマンドを表示する。
 * Service Accountが設定されている場合はsanity（件数照合）を自動実行する（§2）。
 * 全条件PASSで「LCC COMMAND LIVE READ-ONLY BETA READY」を宣言する。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createCommandRepository } from '../src/command/repositories/CommandRepository.js';
import { evaluateSanity, type SanityExpectation } from '../src/command/sources/sanity.js';
import { evaluateBetaGate } from '../src/command/livebeta/betaGate.js';

async function runSanityIfConfigured(): Promise<boolean | null> {
  const configured = Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_FILE
  );
  if (!configured) return null;
  try {
    const expected = JSON.parse(readFileSync('config/sanity.expected.json', 'utf8')) as {
      customers?: number;
      projects?: number;
    };
    const repository = createCommandRepository();
    const dataset = await repository.getDataset(new Date().toISOString());
    const items: SanityExpectation[] = [];
    if (expected.customers !== undefined) {
      items.push({ name: 'customers', expected: expected.customers, actual: dataset.customers.length });
    }
    if (expected.projects !== undefined) {
      items.push({ name: 'projects', expected: expected.projects, actual: dataset.projects.length });
    }
    const result = evaluateSanity(items);
    console.log('[beta-gate] sanity自動実行（§2）:');
    for (const line of result.lines) console.log(`  ${line}`);
    return result.ready;
  } catch (error) {
    console.log(`[beta-gate] sanity実行失敗: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function main(): Promise<void> {
  const sanityReady = await runSanityIfConfigured();
  const realEvalPassed = ((): boolean | null => {
    try {
      const report = JSON.parse(readFileSync('data/real-eval-report.json', 'utf8')) as {
        passed: number;
        total: number;
        hallucinationFailures: number;
      };
      return report.hallucinationFailures === 0 && report.passed / Math.max(report.total, 1) >= 0.9;
    } catch {
      return null;
    }
  })();

  const gate = evaluateBetaGate({
    sanityReady,
    realEvalPassed,
    growthBaselineStarted: existsSync('data/growth-snapshots.jsonl')
  });

  console.log('');
  console.log('=== LIVE BETA Gate（§20） ===');
  console.log(
    `最小起動条件（Sheets SA + 実LLM 1つ）: ${gate.minimumStartSatisfied ? '達成 — 接続済みCapabilityでREAD ONLY BETA開始可能' : '未達成'}`
  );
  console.log('');
  for (const condition of gate.conditions) {
    const mark = condition.status === 'PASS' ? '✅' : condition.status === 'PENDING_USER' ? '🔑' : '⏳';
    console.log(`${mark} [${condition.status}] ${condition.title}`);
    console.log(`     ${condition.detail}`);
    if (condition.action) console.log(`     → ${condition.action}`);
  }
  console.log('');
  if (gate.ready) {
    console.log(`🎉 ${gate.declaration}`);
  } else {
    const userSteps = gate.conditions.filter((c) => c.status === 'PENDING_USER');
    const runtimeSteps = gate.conditions.filter((c) => c.status === 'PENDING_RUNTIME');
    console.log(`判定: NOT READY（ユーザー操作待ち ${userSteps.length}件 / 接続後の検証待ち ${runtimeSteps.length}件）`);
    console.log('※未解決Gap（銀行・会計・日報紐付け）はGate条件ではありません（§1: 全体を止めない）');
  }
}

main().catch((error) => {
  console.error('[beta-gate] 失敗:', error);
  process.exitCode = 1;
});
