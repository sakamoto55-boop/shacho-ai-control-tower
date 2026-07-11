import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/providers/MockAIProvider.js';
import { analyzeAndSaveMessage } from '../../src/jobs/analyzeIncomingMessages.js';
import { buildDashboardSummary } from '../../src/reports/buildDashboardSummary.js';
import { LocalRepository } from '../../src/repositories/LocalRepository.js';
import { fixtureMessages } from '../fixtures/messages.js';

const NOW = new Date('2026-06-12T09:00:00.000Z');

describe('buildDashboardSummary', () => {
  let dir: string;
  let repo: LocalRepository;
  const provider = new MockAIProvider();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shacho-ai-dashboard-'));
    repo = new LocalRepository(join(dir, 'db.json'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('タイル・行動決定・確認事項・改善候補を集約する', async () => {
    await analyzeAndSaveMessage(repo, fixtureMessages.siteStop, provider);
    await analyzeAndSaveMessage(repo, fixtureMessages.complaint, provider);
    await analyzeAndSaveMessage(repo, fixtureMessages.doneReport, provider);

    const summary = await buildDashboardSummary(repo, NOW);

    expect(summary.tiles.presidentDecision).toBeGreaterThanOrEqual(2);
    expect(summary.tiles.highRisk).toBeGreaterThanOrEqual(2);
    expect(summary.tiles.todayReceived).toBe(3);

    // 行動決定には優先度Aのみが並ぶ
    expect(summary.decisions.inbox.length).toBeGreaterThanOrEqual(2);
    expect(summary.decisions.inbox.every((item) => item.priority === 'A')).toBe(true);

    // リアルタイムは新しい順で全件（完了報告含む）
    expect(summary.realtime.length).toBe(3);

    // 改善候補は過去30日の問題集約（全ソース）から
    expect(summary.improvements.problemCount).toBeGreaterThanOrEqual(2);
    expect(summary.improvements.categories.length).toBeGreaterThan(0);
  });

  it('確認事項に承認待ちの返信下書きが含まれる', async () => {
    await analyzeAndSaveMessage(repo, fixtureMessages.complaint, provider);

    const summary = await buildDashboardSummary(repo, NOW);

    expect(summary.tiles.replyDraftWaiting).toBeGreaterThanOrEqual(1);
    expect(summary.confirmations.replyDrafts.length).toBeGreaterThanOrEqual(1);
    expect(summary.confirmations.replyDrafts[0].recipientName).toBe('C様');
  });

  it('データが空でも空のサマリーを返す', async () => {
    const summary = await buildDashboardSummary(repo, NOW);

    expect(summary.tiles.unreviewed).toBe(0);
    expect(summary.realtime).toEqual([]);
    expect(summary.decisions.inbox).toEqual([]);
    expect(summary.improvements.dxCandidates).toEqual([]);
  });
});
