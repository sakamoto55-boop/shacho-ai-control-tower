import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runEmailAlertJob } from '../../src/jobs/emailAlertJob.js';
import { LocalRepository } from '../../src/repositories/LocalRepository.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function makeTempRepo() {
  const dbPath = join(tmpdir(), `test-alert-${randomUUID()}.json`);
  return new LocalRepository(dbPath);
}

describe('runEmailAlertJob', () => {
  beforeEach(() => {
    vi.stubEnv('ALERT_SAVE_PATH', join(tmpdir(), `alerts-${randomUUID()}`));
    vi.stubEnv('AI_PROVIDER', 'mock');
    // No Gmail creds: will use MockGmailConnector which returns []
  });

  it('returns zero-count result when Gmail is not configured', async () => {
    const repo = makeTempRepo();
    const result = await runEmailAlertJob(repo, 'morning');
    expect(result.slot).toBe('morning');
    expect(result.slotLabel).toBe('朝');
    expect(result.processedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.alertText).toContain('メールアラート');
    expect(result.alertText).toContain('朝の部');
    expect(result.alertText).toContain('要対応メールはありません');
  });

  it('returns correct slot labels for all slots', async () => {
    const repo = makeTempRepo();
    const morning = await runEmailAlertJob(repo, 'morning');
    const noon = await runEmailAlertJob(repo, 'noon');
    const evening = await runEmailAlertJob(repo, 'evening');
    expect(morning.slotLabel).toBe('朝');
    expect(noon.slotLabel).toBe('昼');
    expect(evening.slotLabel).toBe('夕');
  });

  it('saves alert file to ALERT_SAVE_PATH', async () => {
    const repo = makeTempRepo();
    const result = await runEmailAlertJob(repo, 'noon');
    expect(result.savedPath).toBeDefined();
    expect(result.savedPath).toMatch(/noon\.txt$/);
  });

  it('alertText contains next slot info', async () => {
    const repo = makeTempRepo();
    const morning = await runEmailAlertJob(repo, 'morning');
    expect(morning.alertText).toContain('12:30');
    const noon = await runEmailAlertJob(repo, 'noon');
    expect(noon.alertText).toContain('18:00');
    const evening = await runEmailAlertJob(repo, 'evening');
    expect(evening.alertText).toContain('翌08:00');
  });
});
