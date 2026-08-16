import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/providers/MockAIProvider.js';
import { ingestSnsInquiry } from '../../src/jobs/snsLeadPipeline.js';
import { planSnsPosts } from '../../src/jobs/snsPostJobs.js';
import { generateRevenueReport } from '../../src/reports/generateRevenueReport.js';
import { LocalRepository } from '../../src/repositories/LocalRepository.js';
import { fixtureSnsInquiries } from '../fixtures/snsInquiries.js';

const NOW = new Date('2026-08-17T09:00:00.000Z');

describe('generateRevenueReport', () => {
  let dir: string;
  let repo: LocalRepository;
  const provider = new MockAIProvider();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shacho-ai-revenue-'));
    repo = new LocalRepository(join(dir, 'db.json'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('反響と投稿予定をまとめた集客レポートを作る', async () => {
    await ingestSnsInquiry(repo, fixtureSnsInquiries.hotDemolition, provider);
    await ingestSnsInquiry(repo, fixtureSnsInquiries.warmExterior, provider);
    await planSnsPosts(repo, { fromDate: '2026-08-17', days: 3, channels: ['instagram'] }, provider);

    const report = await generateRevenueReport(repo, NOW);

    expect(report.kind).toBe('revenue');
    expect(report.text).toContain('【社長AI管制塔｜集客・収益】');
    expect(report.counts.newLeads).toBe(2);
    expect(report.counts.hotLeads).toBe(1);
    expect(report.counts.unrepliedLeads).toBe(2);
    expect(report.counts.postsScheduled).toBe(3);
    expect(report.counts.pipelineValueYen).toBeGreaterThan(0);
    // 確度で重み付けした金額は合計を超えない
    expect(report.counts.weightedPipelineValueYen).toBeLessThan(report.counts.pipelineValueYen);
  });

  it('売り込みDMを集客数に数えない', async () => {
    await ingestSnsInquiry(repo, fixtureSnsInquiries.spam, provider);

    const report = await generateRevenueReport(repo, NOW);

    expect(report.counts.newLeads).toBe(0);
    expect(report.counts.pipelineValueYen).toBe(0);
  });

  it('受注・失注から受注率を出す', async () => {
    const won = await ingestSnsInquiry(repo, fixtureSnsInquiries.hotDemolition, provider);
    const lost = await ingestSnsInquiry(repo, fixtureSnsInquiries.warmExterior, provider);
    await repo.updateLeadRecord(won.lead.id, { stage: 'won' });
    await repo.updateLeadRecord(lost.lead.id, { stage: 'lost' });

    const report = await generateRevenueReport(repo, NOW);

    expect(report.counts.wonLeads).toBe(1);
    expect(report.counts.lostLeads).toBe(1);
    expect(report.counts.wonValueYen).toBeGreaterThan(0);
    expect(report.text).toContain('受注率 50%');
  });

  it('データが無くてもレポートを返す', async () => {
    const report = await generateRevenueReport(repo, NOW);

    expect(report.text).toContain('なし');
    expect(report.counts.pipelineValueYen).toBe(0);
  });
});
