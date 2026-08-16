import {
  BUSINESS_LINE_LABELS,
  isOpenLeadStage,
  LEAD_STAGE_LABELS,
  winProbability
} from '../domain/leadRules.js';
import type { LeadRecord, RevenueCounts, RevenueReport, SnsPostDraftRecord } from '../domain/types.js';
import type { Repository } from '../repositories/Repository.js';
import { shiftIsoDate, todayIsoDate } from '../utils/date.js';

function toManYen(yen: number): string {
  return `${Math.round(yen / 10_000).toLocaleString('ja-JP')}万円`;
}

function lineOrNone<T>(items: T[], formatter: (item: T, index: number) => string): string {
  if (items.length === 0) return 'なし';
  return items.map(formatter).join('\n');
}

function describeLead(lead: LeadRecord): string {
  const name = lead.displayName || lead.accountName || 'アカウント不明';
  const value = lead.estimatedValueYen ? `／見込${toManYen(lead.estimatedValueYen)}` : '';
  const area = lead.area ? `${lead.area} ` : '';
  return `${name}（${lead.channel}／${area}${BUSINESS_LINE_LABELS[lead.businessLine]}／確度${lead.leadScore}${value}） ${lead.nextAction}`;
}

function describePostDraft(draft: SnsPostDraftRecord): string {
  const status =
    draft.approvalStatus === 'needs_revision'
      ? '⚠要修正'
      : draft.approvalStatus === 'approved'
        ? '承認済'
        : draft.approvalStatus === 'sent'
          ? '投稿済'
          : '確認待ち';
  return `${draft.scheduledDate} ${draft.scheduledTime} [${draft.channel}] ${draft.theme}（${BUSINESS_LINE_LABELS[draft.businessLine]}） ${status}`;
}

/**
 * SNS集客から受注までのパイプラインをまとめた社長向けレポート。
 * 見込み金額は平均受注単価ベースの概算であり、確定値ではない。
 */
export async function generateRevenueReport(
  repository: Repository,
  now = new Date(),
  windowDays = 30
): Promise<RevenueReport> {
  const today = todayIsoDate(now);
  const windowFrom = shiftIsoDate(today, -windowDays);
  const weekAhead = shiftIsoDate(today, 7);

  const leads = (await repository.getLeadsByDateRange({ from: windowFrom })).filter((lead) => !lead.isSpam);
  const postDrafts = await repository.getSnsPostDraftsByDateRange({ from: windowFrom });

  const openLeads = leads.filter((lead) => isOpenLeadStage(lead.stage));
  const newLeads = leads.filter((lead) => lead.receivedAt.slice(0, 10) === today);
  const hotLeads = openLeads.filter((lead) => lead.temperature === 'hot');
  const unrepliedLeads = openLeads.filter((lead) => lead.lastContactedAt === null);
  const followUpDue = openLeads.filter((lead) => lead.followUpDate !== null && lead.followUpDate <= today);
  const estimatingLeads = openLeads.filter((lead) => lead.stage === 'estimating' || lead.stage === 'proposed');
  const wonLeads = leads.filter((lead) => lead.stage === 'won');
  const lostLeads = leads.filter((lead) => lead.stage === 'lost');

  const pipelineValueYen = openLeads.reduce((sum, lead) => sum + (lead.estimatedValueYen ?? 0), 0);
  const weightedPipelineValueYen = Math.round(
    openLeads.reduce(
      (sum, lead) => sum + (lead.estimatedValueYen ?? 0) * winProbability(lead.stage, lead.temperature),
      0
    )
  );
  const wonValueYen = wonLeads.reduce((sum, lead) => sum + (lead.estimatedValueYen ?? 0), 0);

  const waitingDrafts = postDrafts.filter((draft) => draft.approvalStatus === 'waiting');
  const needsRevisionDrafts = postDrafts.filter((draft) => draft.approvalStatus === 'needs_revision');
  const scheduledDrafts = postDrafts
    .filter(
      (draft) =>
        draft.scheduledDate >= today &&
        draft.scheduledDate <= weekAhead &&
        draft.approvalStatus !== 'canceled'
    )
    .sort((a, b) => `${a.scheduledDate}${a.scheduledTime}`.localeCompare(`${b.scheduledDate}${b.scheduledTime}`));

  const counts: RevenueCounts = {
    postDraftsWaiting: waitingDrafts.length,
    postsScheduled: scheduledDrafts.length,
    newLeads: newLeads.length,
    hotLeads: hotLeads.length,
    unrepliedLeads: unrepliedLeads.length,
    followUpDue: followUpDue.length,
    estimatingLeads: estimatingLeads.length,
    wonLeads: wonLeads.length,
    lostLeads: lostLeads.length,
    pipelineValueYen,
    weightedPipelineValueYen,
    wonValueYen
  };

  const closedCount = wonLeads.length + lostLeads.length;
  const winRateText = closedCount > 0 ? `${Math.round((wonLeads.length / closedCount) * 100)}%` : '算出不可';

  const topHot = [...hotLeads].sort((a, b) => b.leadScore - a.leadScore).slice(0, 3);
  const topFollowUp = [...followUpDue]
    .sort((a, b) => (a.followUpDate ?? '').localeCompare(b.followUpDate ?? ''))
    .slice(0, 3);

  const text = [
    '【社長AI管制塔｜集客・収益】',
    `直近${windowDays}日のSNS集客から受注までの状況です。金額は平均受注単価ベースの概算です。`,
    '',
    '--- 件数サマリー ---',
    `本日の新規反響  : ${counts.newLeads}件`,
    `当日返信すべき  : ${counts.hotLeads}件`,
    `未返信リード    : ${counts.unrepliedLeads}件`,
    `追客期限到来    : ${counts.followUpDue}件`,
    `見積・提案中    : ${counts.estimatingLeads}件`,
    `受注 / 失注     : ${counts.wonLeads}件 / ${counts.lostLeads}件（受注率 ${winRateText}）`,
    '',
    '--- 見込み金額（概算） ---',
    `進行中の合計    : ${toManYen(counts.pipelineValueYen)}`,
    `確度で重み付け  : ${toManYen(counts.weightedPipelineValueYen)}`,
    `受注済み        : ${toManYen(counts.wonValueYen)}`,
    '',
    '--- 今すぐ返すべき反響 ---',
    lineOrNone(topHot, (lead, index) => `${index + 1}. ${describeLead(lead)}`),
    '',
    '--- 追客期限が来たリード ---',
    lineOrNone(
      topFollowUp,
      (lead, index) =>
        `${index + 1}. ${describeLead(lead)}【${LEAD_STAGE_LABELS[lead.stage]}／追客${lead.followUpCount}回目まで完了】`
    ),
    '',
    '--- 投稿カレンダー（今後7日） ---',
    `確認待ち ${counts.postDraftsWaiting}件 / 要修正 ${needsRevisionDrafts.length}件`,
    lineOrNone(scheduledDrafts.slice(0, 5), (draft, index) => `${index + 1}. ${describePostDraft(draft)}`),
    ''
  ].join('\n');

  return {
    kind: 'revenue',
    generatedAt: now.toISOString(),
    text,
    counts
  };
}
