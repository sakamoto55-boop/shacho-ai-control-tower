import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/providers/MockAIProvider.js';
import { followUpLeads, ingestSnsInquiries, ingestSnsInquiry } from '../../src/jobs/snsLeadPipeline.js';
import { LocalRepository } from '../../src/repositories/LocalRepository.js';
import { fixtureSnsInquiries } from '../fixtures/snsInquiries.js';

describe('SNS集客パイプライン', () => {
  let dir: string;
  let repo: LocalRepository;
  const provider = new MockAIProvider();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shacho-ai-sns-'));
    repo = new LocalRepository(join(dir, 'db.json'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('確度の高い反響からリード・一次対応タスク・返信下書きを作る', async () => {
    const bundle = await ingestSnsInquiry(repo, fixtureSnsInquiries.hotDemolition, provider);

    expect(bundle.lead.temperature).toBe('hot');
    expect(bundle.lead.businessLine).toBe('demolition');
    expect(bundle.lead.stage).toBe('new');
    expect(bundle.lead.estimatedValueYen).not.toBeNull();
    expect(bundle.tasks).toHaveLength(1);
    expect(bundle.tasks[0].priority).toBe('A');
    expect(bundle.tasks[0].dueDateText).toBe('今日中');
    expect(bundle.replyDraft?.approvalStatus).toBe('waiting');
    // 社外向けの返信は必ず人の確認を挟む
    expect(bundle.replyDraft?.ngReasons.join('')).toContain('人が確認');
  });

  it('返信下書きに金額や工期を書かず、不足情報のヒアリングに留める', async () => {
    const bundle = await ingestSnsInquiry(repo, fixtureSnsInquiries.warmExterior, provider);
    const draft = bundle.replyDraft?.draftText ?? '';

    expect(draft).not.toMatch(/\d+\s*万円/);
    expect(draft).toContain('お教えいただけますでしょうか');
    expect(bundle.replyDraft?.confirmationNeeded.length).toBeGreaterThan(0);
  });

  it('感想コメントには住所や予算を聞き返さず、お礼だけを返す', async () => {
    const bundle = await ingestSnsInquiry(repo, fixtureSnsInquiries.coldComment, provider);
    const draft = bundle.replyDraft?.draftText ?? '';

    expect(bundle.lead.temperature).toBe('cold');
    expect(bundle.lead.estimatedValueYen).toBeNull();
    expect(draft).toContain('コメントありがとうございます');
    expect(draft).not.toContain('住所');
    expect(draft).not.toContain('予算');
  });

  it('AI受信箱にはoriginalChannel=snsとして記録する', async () => {
    const bundle = await ingestSnsInquiry(repo, fixtureSnsInquiries.hotDemolition, provider);

    expect(bundle.inbox.source).toBe('external_forward');
    expect(bundle.inbox.originalChannel).toBe('sns');
    expect(bundle.inbox.riskType).toBe('lost_order');
  });

  it('売り込みDMはタスクも返信下書きも作らない', async () => {
    const bundle = await ingestSnsInquiry(repo, fixtureSnsInquiries.spam, provider);

    expect(bundle.lead.isSpam).toBe(true);
    expect(bundle.lead.stage).toBe('lost');
    expect(bundle.tasks).toHaveLength(0);
    expect(bundle.replyDraft).toBeUndefined();
    expect(bundle.inbox.status).toBe('archived');
  });

  it('同じ反響を二度取り込んでもタスクを重複させない', async () => {
    await ingestSnsInquiry(repo, fixtureSnsInquiries.hotDemolition, provider);
    const second = await ingestSnsInquiry(repo, fixtureSnsInquiries.hotDemolition, provider);

    expect(second.tasks).toHaveLength(0);
    expect(await repo.getLeadsByDateRange()).toHaveLength(1);
    expect(await repo.getTasksByDateRange()).toHaveLength(1);
  });

  it('確度の高い反響だけ即時通知に回す', async () => {
    const result = await ingestSnsInquiries(
      repo,
      [fixtureSnsInquiries.hotDemolition, fixtureSnsInquiries.coldComment, fixtureSnsInquiries.spam],
      provider
    );

    expect(result.processed).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(result.hotLeadNotifications).toHaveLength(1);
    expect(result.hotLeadNotifications[0]).toContain('SNS反響・当日返信');
  });

  it('追客日を過ぎたリードに追客タスクを作り、次回追客日を更新する', async () => {
    const bundle = await ingestSnsInquiry(repo, fixtureSnsInquiries.warmExterior, provider);
    await repo.updateLeadRecord(bundle.lead.id, { followUpDate: '2026-08-18' });

    const result = await followUpLeads(repo, new Date('2026-08-20T00:00:00.000Z'));

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].taskTitle).toContain('追客1回目');
    const [lead] = await repo.getLeadsByDateRange();
    expect(lead.followUpCount).toBe(1);
    expect(lead.followUpDate).toBe('2026-08-23');
  });

  it('追客上限に達したリードは長期フォローへ移して自動追客を止める', async () => {
    const bundle = await ingestSnsInquiry(repo, fixtureSnsInquiries.warmExterior, provider);
    await repo.updateLeadRecord(bundle.lead.id, { followUpDate: '2026-08-18', followUpCount: 5 });

    const result = await followUpLeads(repo, new Date('2026-08-20T00:00:00.000Z'));

    expect(result.tasks).toHaveLength(0);
    expect(result.movedToNurturing).toEqual([bundle.lead.id]);
    const [lead] = await repo.getLeadsByDateRange();
    expect(lead.stage).toBe('nurturing');
    expect(lead.followUpDate).toBeNull();
  });

  it('受注・失注したリードには追客タスクを作らない', async () => {
    const bundle = await ingestSnsInquiry(repo, fixtureSnsInquiries.warmExterior, provider);
    await repo.updateLeadRecord(bundle.lead.id, { followUpDate: '2026-08-18', stage: 'won' });

    const result = await followUpLeads(repo, new Date('2026-08-20T00:00:00.000Z'));

    expect(result.tasks).toHaveLength(0);
  });
});
