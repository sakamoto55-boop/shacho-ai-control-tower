import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { MemoryService, resetMemorySeq } from '../../../src/command/memory/store.js';
import {
  buildExperiment,
  completeExperiment,
  discoverProblems,
  resetExperimentSeq,
  runMemoryMaintenance
} from '../../../src/command/memory/maintenance.js';
import { buildSeedDataset } from '../../../src/command/data/seed.js';
import { createCommandApp } from '../../../src/command/server/routes.js';

const NOW = '2026-08-08T00:00:00.000Z';

describe('M: Experiment Engine / Result Feedback Loop', () => {
  beforeEach(() => {
    resetMemorySeq();
    resetExperimentSeq();
  });

  it('仮説→実験→結果→Lessonのループを保持する', async () => {
    const repository = new InMemoryCommandRepository();
    const experiment = buildExperiment(
      {
        companyId: 'lcc',
        hypothesis: '7日後自動フォローで受注率が改善する',
        metric: '見積→受注率',
        baseline: '24%',
        target: '30%'
      },
      'user:社長',
      NOW
    );
    await repository.saveExperiment(experiment);
    expect(experiment.status).toBe('RUNNING');

    const { experiment: completed, lessonStatement } = completeExperiment(
      experiment,
      '31%',
      '7日フォロー有効',
      NOW
    );
    expect(completed.status).toBe('COMPLETED');
    expect(lessonStatement).toContain('24% → 31%');
    expect(lessonStatement).toContain('7日フォロー有効');
  });

  it('結果未登録の実験をメンテナンスで検出する（Result Feedback Loop）', async () => {
    const repository = new InMemoryCommandRepository();
    const experiment = buildExperiment(
      {
        companyId: 'lcc',
        hypothesis: '朝Briefで対応漏れが減る',
        metric: '未対応件数',
        baseline: '5件/週',
        target: '1件/週',
        plannedEndAt: '2026-08-01' // 期限超過
      },
      'user:社長',
      '2026-07-01T00:00:00.000Z'
    );
    await repository.saveExperiment(experiment);
    const report = await runMemoryMaintenance(repository, NOW);
    expect(report.experimentsAwaitingResult.some((s) => s.includes('まだ登録されていません'))).toBe(
      true
    );
    expect((await repository.getExperiments())[0].status).toBe('AWAITING_RESULT');
  });

  it('API経由: 実験登録→結果登録でLESSONが会社Memoryへ戻る', async () => {
    const repository = new InMemoryCommandRepository();
    const app = createCommandApp({ repository });
    const created = await app.request('/experiments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        companyId: 'lcc',
        hypothesis: '7日後自動フォローで受注率改善',
        metric: '見積→受注率',
        baseline: '24%',
        target: '30%'
      })
    });
    expect(created.status).toBe(200);
    const experiment = (await created.json()) as { experimentId: string };

    const resultRes = await app.request(`/experiments/${experiment.experimentId}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: '31%', evaluation: '7日フォロー有効' })
    });
    expect(resultRes.status).toBe(200);
    const body = (await resultRes.json()) as { lesson: { type: string; statement: string } };
    expect(body.lesson.type).toBe('LESSON');
    expect(body.lesson.statement).toContain('31%');
    const memories = await repository.getMemories();
    expect(memories.some((m) => m.type === 'LESSON')).toBe(true);
  });
});

describe('M: Nightly Maintenance / Proactive Discovery', () => {
  beforeEach(() => resetMemorySeq());

  it('期限切れDECISIONをEXPIREDへ遷移し報告する（内容は書き換えない）', async () => {
    const repository = new InMemoryCommandRepository();
    const service = new MemoryService(repository);
    await service.save(
      {
        type: 'DECISION',
        statement: 'A案件は粗利より完工を優先',
        entities: [],
        relations: [],
        layer: 'PRESIDENT',
        sensitivity: 'NORMAL',
        companyId: 'lcc',
        source: 'CONVERSATION',
        sourceId: 's1',
        validFrom: '2026-07-01',
        validUntil: '2026-08-01', // 期限切れ
        confidence: 'CONFIRMED',
        createdBy: 'user:社長',
        reviewStatus: 'CONFIRMED_BY_USER',
        evidence: [{ label: '決定', value: '会話', source: '会話', asOf: NOW }]
      },
      '2026-07-01T00:00:00.000Z'
    );
    const report = await runMemoryMaintenance(repository, NOW);
    expect(report.expiredDecisions).toContain('A案件は粗利より完工を優先');
    const memory = (await repository.getMemories())[0];
    expect(memory.status).toBe('EXPIRED');
    expect(memory.statement).toBe('A案件は粗利より完工を優先'); // 内容は不変
  });

  it('未検証HYPOTHESISと確認待ちMemoryを報告する', async () => {
    const repository = new InMemoryCommandRepository();
    const service = new MemoryService(repository);
    await service.save(
      {
        type: 'HYPOTHESIS',
        statement: '営業成果が低下している可能性',
        entities: [],
        relations: [],
        layer: 'OPERATIONAL',
        sensitivity: 'NORMAL',
        companyId: 'lcc',
        source: 'CONVERSATION',
        sourceId: 's1',
        validFrom: '2026-08-08',
        confidence: 'UNVERIFIED',
        createdBy: 'ai:curator',
        reviewStatus: 'AUTO',
        evidence: []
      },
      NOW
    );
    const report = await runMemoryMaintenance(repository, NOW);
    expect(report.unverifiedHypotheses).toContain('営業成果が低下している可能性');
  });

  it('Proactive Discovery: 複数案件に共通する原価超過パターンを提案する', () => {
    const dataset = buildSeedDataset(NOW);
    // 2件目の処分費超過案件を追加（prj-aは既に処分費超過）
    dataset.projects.push({
      projectId: 'prj-z',
      companyId: 'lcc',
      customerId: 'cust-ono',
      name: 'Z案件（処分費超過）',
      stage: 'in_progress',
      orderAmount: 5_000_000,
      plannedMarginRate: 0.3,
      updatedAt: NOW
    });
    dataset.costs.push(
      {
        costId: 'c-z-p',
        companyId: 'lcc',
        projectId: 'prj-z',
        category: 'disposal',
        amount: 1_000_000,
        date: '2026-07-20',
        kind: 'planned'
      },
      {
        costId: 'c-z-a',
        companyId: 'lcc',
        projectId: 'prj-z',
        category: 'disposal',
        amount: 1_800_000,
        date: '2026-08-05',
        kind: 'actual'
      },
      {
        costId: 'c-z-l',
        companyId: 'lcc',
        projectId: 'prj-z',
        category: 'labor',
        amount: 2_500_000,
        date: '2026-08-05',
        kind: 'actual'
      }
    );
    const insights = discoverProblems(dataset, 'lcc');
    expect(insights.some((s) => s.includes('処分') && s.includes('再分析'))).toBe(true);
  });
});
