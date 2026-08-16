import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/providers/MockAIProvider.js';
import type { AIProvider } from '../../src/ai/providers/AIProvider.js';
import type { SnsPostDraftResult, SnsPostGenerationInput } from '../../src/domain/types.js';
import {
  approveSnsPostDraft,
  planSnsPosts,
  publishApprovedSnsPosts
} from '../../src/jobs/snsPostJobs.js';
import { LocalRepository } from '../../src/repositories/LocalRepository.js';

/** 誇大表現を返すプロバイダ。表現チェックが効くかを確認するために使う。 */
class OverclaimingProvider extends MockAIProvider implements AIProvider {
  async generateSnsPost(input: SnsPostGenerationInput): Promise<SnsPostDraftResult> {
    return {
      title: `${input.scheduledDate} 誇大表現テスト`,
      body: '必ず地域No.1の仕上がりをお約束します。',
      hashtags: ['解体工事'],
      callToAction: 'DMでご相談ください。',
      mediaHint: '完了写真',
      ngReasons: []
    };
  }
}

describe('SNS投稿ジョブ', () => {
  let dir: string;
  let repo: LocalRepository;
  const provider = new MockAIProvider();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shacho-ai-post-'));
    repo = new LocalRepository(join(dir, 'db.json'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('投稿カレンダー分の下書きを確認待ちで保存する', async () => {
    const result = await planSnsPosts(
      repo,
      { fromDate: '2026-08-17', days: 7, channels: ['instagram'], area: '前橋市' },
      provider
    );

    expect(result.created).toHaveLength(7);
    expect(result.errors).toHaveLength(0);
    expect(result.created.every((draft) => draft.approvalStatus === 'waiting')).toBe(true);
    expect(result.created.every((draft) => draft.publishedAt === null)).toBe(true);
    expect(result.created[0].body).toContain('前橋市');
    expect(result.created[0].mediaHint.length).toBeGreaterThan(0);
  });

  it('同じ枠の下書きを二重に作らない', async () => {
    const options = { fromDate: '2026-08-17', days: 3, channels: ['instagram' as const] };
    await planSnsPosts(repo, options, provider);
    const second = await planSnsPosts(repo, options, provider);

    expect(second.created).toHaveLength(0);
    expect(second.skipped).toBe(3);
    expect(await repo.getSnsPostDraftsByDateRange()).toHaveLength(3);
  });

  it('チャンネルごとの文字数上限に収める', async () => {
    const result = await planSnsPosts(
      repo,
      { fromDate: '2026-08-17', days: 1, channels: ['x'] },
      provider
    );

    expect(result.created[0].body.length).toBeLessThanOrEqual(130);
  });

  it('誇大表現を含む下書きは要修正にして承認させない', async () => {
    const result = await planSnsPosts(
      repo,
      { fromDate: '2026-08-17', days: 1, channels: ['instagram'] },
      new OverclaimingProvider()
    );

    expect(result.needsRevision).toHaveLength(1);
    const approval = await approveSnsPostDraft(repo, result.created[0].id);
    expect(approval.ok).toBe(false);
    expect(approval.reason).toContain('修正');
  });

  it('承認した投稿だけを予定日にdry-runで公開する', async () => {
    const planned = await planSnsPosts(
      repo,
      { fromDate: '2026-08-17', days: 2, channels: ['instagram'] },
      provider
    );
    const approval = await approveSnsPostDraft(repo, planned.created[0].id);
    expect(approval.ok).toBe(true);

    const published = await publishApprovedSnsPosts(repo, new Date('2026-08-17T09:00:00.000Z'));

    expect(published.dryRun).toBe(true);
    expect(published.published).toHaveLength(1);
    expect(published.published[0].approvalStatus).toBe('sent');
    expect(published.published[0].publishedAt).not.toBeNull();

    // 未承認の下書きは公開されない
    const drafts = await repo.getSnsPostDraftsByDateRange();
    expect(drafts.filter((draft) => draft.approvalStatus === 'waiting')).toHaveLength(1);
  });

  it('公開済みの投稿を二度公開しない', async () => {
    const planned = await planSnsPosts(
      repo,
      { fromDate: '2026-08-17', days: 1, channels: ['instagram'] },
      provider
    );
    await approveSnsPostDraft(repo, planned.created[0].id);
    await publishApprovedSnsPosts(repo, new Date('2026-08-17T09:00:00.000Z'));

    const second = await publishApprovedSnsPosts(repo, new Date('2026-08-18T09:00:00.000Z'));
    expect(second.published).toHaveLength(0);
  });
});
