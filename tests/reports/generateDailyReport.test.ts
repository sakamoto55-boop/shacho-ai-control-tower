import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/providers/MockAIProvider.js';
import { analyzeAndSaveMessage } from '../../src/jobs/analyzeIncomingMessages.js';
import { generateDailyReport } from '../../src/reports/generateDailyReport.js';
import { LocalRepository } from '../../src/repositories/LocalRepository.js';
import { fixtureMessages } from '../fixtures/messages.js';

describe('generateDailyReport', () => {
  it('generates a morning report with counts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shacho-ai-'));
    try {
      const repo = new LocalRepository(join(dir, 'db.json'));
      const provider = new MockAIProvider();
      await analyzeAndSaveMessage(repo, fixtureMessages.siteStop, provider);
      await analyzeAndSaveMessage(repo, fixtureMessages.complaint, provider);
      const report = await generateDailyReport(repo, 'morning', new Date('2026-06-12T08:00:00.000Z'));

      expect(report.text).toContain('【社長AI管制塔｜朝】');
      expect(report.counts.presidentDecision).toBeGreaterThanOrEqual(2);
      expect(report.counts.risks).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
