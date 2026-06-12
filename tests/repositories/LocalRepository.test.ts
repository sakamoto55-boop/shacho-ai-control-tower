import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { LocalRepository } from '../../src/repositories/LocalRepository.js';
import { analyzeAndSaveMessage } from '../../src/jobs/analyzeIncomingMessages.js';
import { MockAIProvider } from '../../src/ai/providers/MockAIProvider.js';
import { fixtureMessages } from '../fixtures/messages.js';

describe('LocalRepository', () => {
  it('saves inbox, tasks, and reply draft', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shacho-ai-'));
    try {
      const repo = new LocalRepository(join(dir, 'db.json'));
      await analyzeAndSaveMessage(repo, fixtureMessages.estimateToday, new MockAIProvider());
      const inbox = await repo.getInboxRecordsByDateRange();
      const tasks = await repo.getTasksByDateRange();
      const drafts = await repo.getReplyDraftsByDateRange();

      expect(inbox).toHaveLength(1);
      expect(tasks.length).toBeGreaterThan(0);
      expect(drafts).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
