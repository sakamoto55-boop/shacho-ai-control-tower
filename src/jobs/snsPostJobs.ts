import { randomUUID } from 'node:crypto';
import { createAIProvider } from '../ai/analyzeMessage.js';
import type { AIProvider } from '../ai/providers/AIProvider.js';
import { createSnsConnector } from '../connectors/sns.js';
import { buildSnsPostPlan, checkAdCompliance, type SnsPostPlanOptions } from '../domain/snsContentRules.js';
import type { SnsPostDraftRecord } from '../domain/types.js';
import type { Repository } from '../repositories/Repository.js';
import { nowIso, todayIsoDate } from '../utils/date.js';

export interface PlanSnsPostsResult {
  /** 新しく保存された投稿下書き */
  created: SnsPostDraftRecord[];
  /** 既に同じ枠の下書きがあり、生成をスキップした件数 */
  skipped: number;
  /** 表現の修正が必要な下書き（承認不可） */
  needsRevision: SnsPostDraftRecord[];
  errors: string[];
}

/**
 * 投稿カレンダーを組み、各コマの投稿下書きを生成して保存する。
 * 保存時点では全てapprovalStatus='waiting'で、投稿は行わない。
 */
export async function planSnsPosts(
  repository: Repository,
  options: SnsPostPlanOptions,
  provider: AIProvider = createAIProvider()
): Promise<PlanSnsPostsResult> {
  const plan = buildSnsPostPlan(options);
  const drafts: SnsPostDraftRecord[] = [];
  const errors: string[] = [];

  for (const slot of plan) {
    try {
      const generated = await provider.generateSnsPost(slot);
      const now = nowIso();
      // プロバイダの自己申告に頼らず、こちらでも表現チェックを掛ける。
      const ngReasons = Array.from(
        new Set([...generated.ngReasons, ...checkAdCompliance(`${generated.body}\n${generated.callToAction}`)])
      );

      drafts.push({
        id: randomUUID(),
        channel: slot.channel,
        scheduledDate: slot.scheduledDate,
        scheduledTime: slot.scheduledTime,
        businessLine: slot.businessLine,
        purpose: slot.purpose,
        theme: slot.theme,
        title: generated.title,
        body: generated.body,
        hashtags: generated.hashtags,
        callToAction: generated.callToAction,
        mediaHint: generated.mediaHint,
        ngReasons,
        approvalStatus: ngReasons.length > 0 ? 'needs_revision' : 'waiting',
        publishedAt: null,
        createdAt: now,
        updatedAt: now
      });
    } catch (error) {
      errors.push(
        `${slot.scheduledDate} ${slot.channel}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const created = await repository.createSnsPostDraftRecords(drafts);

  return {
    created,
    skipped: drafts.length - created.length,
    needsRevision: created.filter((draft) => draft.approvalStatus === 'needs_revision'),
    errors
  };
}

export interface ApproveSnsPostResult {
  ok: boolean;
  draft: SnsPostDraftRecord | null;
  reason: string;
}

/**
 * 投稿下書きを承認する。表現上の指摘が残っている下書きは承認できない。
 */
export async function approveSnsPostDraft(
  repository: Repository,
  id: string
): Promise<ApproveSnsPostResult> {
  const drafts = await repository.getSnsPostDraftsByDateRange();
  const target = drafts.find((draft) => draft.id === id);
  if (!target) {
    return { ok: false, draft: null, reason: '対象の投稿下書きが見つかりません。' };
  }
  if (target.ngReasons.length > 0) {
    return {
      ok: false,
      draft: target,
      reason: `表現の修正が必要です: ${target.ngReasons.join(' / ')}`
    };
  }
  if (target.approvalStatus === 'sent') {
    return { ok: false, draft: target, reason: '既に投稿処理済みです。' };
  }

  const updated = await repository.updateSnsPostDraftRecord(id, { approvalStatus: 'approved' });
  return { ok: true, draft: updated, reason: '' };
}

export interface PublishSnsPostsResult {
  published: SnsPostDraftRecord[];
  dryRun: boolean;
}

/**
 * 承認済みかつ予定日を迎えた投稿を公開する。
 * Phase 1のコネクタは常にdry-runで、実際にはSNSへ送信しない。
 */
export async function publishApprovedSnsPosts(
  repository: Repository,
  now = new Date()
): Promise<PublishSnsPostsResult> {
  const today = todayIsoDate(now);
  const connector = createSnsConnector();
  const drafts = await repository.getSnsPostDraftsByDateRange({ to: today });
  const targets = drafts.filter(
    (draft) => draft.approvalStatus === 'approved' && draft.publishedAt === null
  );

  const published: SnsPostDraftRecord[] = [];
  let dryRun = true;

  for (const draft of targets) {
    const result = await connector.publishPost(draft);
    dryRun = dryRun && result.dryRun;
    const updated = await repository.updateSnsPostDraftRecord(draft.id, {
      approvalStatus: 'sent',
      publishedAt: nowIso()
    });
    if (updated) published.push(updated);
  }

  return { published, dryRun };
}
