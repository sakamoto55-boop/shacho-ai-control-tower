/**
 * 夜間Memoryメンテナンス（Phase B1 §15）。
 *
 * 既定は DRY RUN: 期限切れDecision・未検証仮説・重複・矛盾・Insightを報告するだけで、
 * Memoryへの状態変更は保存しない。実適用は LCC_MAINTENANCE_APPLY=true のときのみ。
 * cron例: 0 3 * * * cd /path/to/repo && npx tsx scripts/nightly-maintenance.ts >> logs/maintenance.log
 */
import { createCommandRepository } from '../src/command/repositories/CommandRepository.js';
import type { CommandRepository } from '../src/command/repositories/CommandRepository.js';
import { runMemoryMaintenance } from '../src/command/memory/maintenance.js';

/** DRY RUN用: 書き込みを永続化しないラッパー（読み取りは実データ） */
function readOnlyView(repository: CommandRepository): CommandRepository {
  return {
    mode: repository.mode,
    getDataset: (asOf) => repository.getDataset(asOf),
    getStore: () => repository.getStore(),
    saveDecision: async (d) => d,
    saveTask: async (t) => t,
    saveApproval: async (a) => a,
    updateApproval: async () => null,
    saveResearch: async (r) => r,
    getMemories: () => repository.getMemories(),
    saveMemory: async (m) => m,
    getExperiments: () => repository.getExperiments(),
    saveExperiment: async (e) => e,
    getTargets: () => repository.getTargets(),
    saveTarget: async (t) => t,
    getPrinciples: () => repository.getPrinciples(),
    savePrinciple: async (pr) => pr,
    getArtifacts: () => repository.getArtifacts(),
    saveArtifact: async (a) => a,
    getGrowthItems: () => repository.getGrowthItems(),
    saveGrowthItem: async (g) => g,
    getIncidents: () => repository.getIncidents(),
    saveIncident: async (i) => i
  };
}

async function main(): Promise<void> {
  const apply = process.env.LCC_MAINTENANCE_APPLY === 'true';
  const asOf = new Date().toISOString();
  const base = createCommandRepository();
  const repository = apply ? base : readOnlyView(base);
  const dataset = await base.getDataset(asOf);

  const report = await runMemoryMaintenance(repository, asOf, dataset);
  console.log(`[nightly-maintenance] mode=${apply ? 'APPLY' : 'DRY RUN'} asOf=${asOf}`);
  console.log(JSON.stringify(report, null, 2));
  if (!apply) {
    console.log('※DRY RUN: Memoryへの変更は保存していません（適用は LCC_MAINTENANCE_APPLY=true）');
  }
}

main().catch((error) => {
  console.error('[nightly-maintenance] 失敗:', error);
  process.exitCode = 1;
});
