import { randomUUID } from 'node:crypto';
import { createAIProvider } from '../ai/analyzeMessage.js';
import type { AIProvider } from '../ai/providers/AIProvider.js';
import { createLineworksConnector } from '../connectors/lineworks.js';
import {
  BUSINESS_LINE_LABELS,
  FOLLOW_UP_INTERVAL_DAYS,
  MAX_FOLLOW_UP_COUNT,
  PRESIDENT_REVIEW_VALUE_YEN,
  SNS_REPLY_HUMAN_CHECK_REASON
} from '../domain/leadRules.js';
import type {
  InboxRecord,
  LeadRecord,
  ReplyDraftRecord,
  SnsInquiryAnalysisResult,
  SnsInquiryInput,
  StoredLeadBundle,
  TaskRecord
} from '../domain/types.js';
import type { Repository } from '../repositories/Repository.js';
import { nowIso, shiftIsoDate, todayIsoDate } from '../utils/date.js';
import { sha256 } from '../utils/hash.js';
import { normalizeText } from '../utils/textNormalize.js';

function inquiryExternalId(input: SnsInquiryInput, normalized: string): string {
  return input.externalInquiryId ?? sha256(`${input.channel}:${input.receivedAt}:${input.accountName}:${normalized}`);
}

export function buildLeadInboxRecord(
  input: SnsInquiryInput,
  analysis: SnsInquiryAnalysisResult
): InboxRecord {
  const now = nowIso();
  const normalizedText = normalizeText(input.text);
  const label = BUSINESS_LINE_LABELS[analysis.businessLine];

  return {
    id: randomUUID(),
    // SNSは社外からの流入だがMessageSourceは増やさず、originalChannelで区別する。
    source: 'external_forward',
    externalMessageId: `sns:${input.channel}:${inquiryExternalId(input, normalizedText)}`,
    originalChannel: 'sns',
    receivedAt: input.receivedAt,
    senderName: input.displayName || input.accountName,
    senderAddress: input.contact || input.accountName,
    roomName: `SNS/${input.channel}`,
    subject: analysis.isSpam ? 'SNS売り込みDM' : `SNS反響（${label}）`,
    originalText: input.text,
    normalizedText,
    summary: analysis.summary,
    projectName: input.area ? `${input.area}${label}案件` : '',
    customerName: input.displayName || input.accountName,
    priority: analysis.priority,
    replyNeeded: analysis.replyDraft.needed,
    // 反響を放置すると失注につながるため、温度感を失注リスクとして表現する。
    riskType: analysis.isSpam ? 'none' : 'lost_order',
    riskLevel: analysis.isSpam ? 'none' : analysis.temperature === 'hot' ? 'medium' : 'low',
    confidence: analysis.confidence,
    status: analysis.isSpam ? 'archived' : analysis.replyDraft.needed ? 'draft_created' : 'task_created',
    createdAt: now,
    updatedAt: now
  };
}

export function buildLeadRecord(
  inbox: InboxRecord,
  input: SnsInquiryInput,
  analysis: SnsInquiryAnalysisResult
): LeadRecord {
  const now = nowIso();
  const normalizedText = normalizeText(input.text);

  return {
    id: randomUUID(),
    sourceInboxId: inbox.id,
    channel: input.channel,
    externalInquiryId: inquiryExternalId(input, normalizedText),
    receivedAt: input.receivedAt,
    accountName: input.accountName,
    displayName: input.displayName,
    contact: input.contact ?? '',
    area: input.area ?? '',
    postRef: input.postRef ?? '',
    inquiryText: input.text,
    summary: analysis.summary,
    businessLine: analysis.businessLine,
    temperature: analysis.temperature,
    leadScore: analysis.leadScore,
    estimatedValueYen: analysis.estimatedValueYen,
    stage: analysis.isSpam ? 'lost' : 'new',
    isSpam: analysis.isSpam,
    buyingSignals: analysis.buyingSignals,
    missingInfo: analysis.missingInfo,
    nextAction: analysis.nextAction,
    followUpDate: analysis.followUpDate,
    followUpCount: 0,
    lastContactedAt: null,
    ownerType: 'sales',
    createdAt: now,
    updatedAt: now
  };
}

export function buildLeadTaskRecords(
  inbox: InboxRecord,
  lead: LeadRecord,
  analysis: SnsInquiryAnalysisResult
): TaskRecord[] {
  if (analysis.isSpam) return [];

  const now = nowIso();
  const dueDate = lead.temperature === 'hot' ? inbox.receivedAt.slice(0, 10) : lead.followUpDate;
  const dueDateText = lead.temperature === 'hot' ? '今日中' : lead.temperature === 'warm' ? '翌営業日まで' : '今週中';
  const requiresPresident =
    (lead.estimatedValueYen ?? 0) >= PRESIDENT_REVIEW_VALUE_YEN && lead.temperature !== 'cold';

  const detailLines = [
    `${BUSINESS_LINE_LABELS[lead.businessLine]}／確度${lead.leadScore}／${lead.channel}`,
    lead.buyingSignals.length > 0 ? `受注シグナル: ${lead.buyingSignals.join('、')}` : '',
    lead.missingInfo.length > 0 ? `要ヒアリング: ${lead.missingInfo.slice(0, 3).join('、')}` : '',
    lead.estimatedValueYen ? `見込み金額: 約${Math.round(lead.estimatedValueYen / 10_000)}万円（概算）` : ''
  ].filter((line) => line.length > 0);

  return [
    {
      id: randomUUID(),
      sourceInboxId: inbox.id,
      taskTitle: `SNS反響の一次対応（${lead.displayName || lead.accountName}）`,
      taskDetail: detailLines.join('\n'),
      ownerType: requiresPresident ? 'president' : 'sales',
      ownerName: '',
      dueDate,
      dueDateText,
      priority: analysis.priority,
      projectName: inbox.projectName,
      customerName: inbox.customerName,
      nextAction: analysis.nextAction,
      requiresPresident,
      status: 'todo',
      reason: `SNS（${lead.channel}）からの反響です。返信が遅れるほど失注確率が上がります。`,
      createdAt: now,
      updatedAt: now
    }
  ];
}

export function buildLeadReplyDraftRecord(
  inbox: InboxRecord,
  lead: LeadRecord,
  analysis: SnsInquiryAnalysisResult
): ReplyDraftRecord | undefined {
  if (!analysis.replyDraft.needed || analysis.isSpam) return undefined;
  const now = nowIso();
  const ngReasons = analysis.replyDraft.ngReasons.includes(SNS_REPLY_HUMAN_CHECK_REASON)
    ? analysis.replyDraft.ngReasons
    : [...analysis.replyDraft.ngReasons, SNS_REPLY_HUMAN_CHECK_REASON];

  return {
    id: randomUUID(),
    sourceInboxId: inbox.id,
    recipientName: lead.displayName || lead.accountName,
    recipientAddress: lead.contact || lead.accountName,
    draftText: analysis.replyDraft.text,
    tone: analysis.replyDraft.tone,
    confirmationNeeded: analysis.replyDraft.confirmationNeeded,
    ngReasons,
    approvalStatus: 'waiting',
    createdAt: now,
    updatedAt: now
  };
}

/**
 * SNS反響1件を取り込み、AI受信箱・リード・一次対応タスク・返信下書きへ展開する。
 * 返信は下書き止まりで、自動送信はしない。
 */
export async function ingestSnsInquiry(
  repository: Repository,
  input: SnsInquiryInput,
  provider: AIProvider = createAIProvider()
): Promise<StoredLeadBundle> {
  const analysis = await provider.analyzeSnsInquiry(input);

  const builtInbox = buildLeadInboxRecord(input, analysis);
  const inbox = await repository.createInboxRecord(builtInbox);

  // 同じ反響を二重に取り込んだ場合は、既存レコードをそのまま返す。
  if (inbox.id !== builtInbox.id) {
    const existingLeads = await repository.getLeadsByDateRange();
    const existingLead = existingLeads.find((item) => item.sourceInboxId === inbox.id);
    if (existingLead) {
      return { inbox, lead: existingLead, tasks: [] };
    }
  }

  const lead = await repository.createLeadRecord(buildLeadRecord(inbox, input, analysis));
  const tasks = await repository.createTaskRecords(buildLeadTaskRecords(inbox, lead, analysis));
  const replyDraft = buildLeadReplyDraftRecord(inbox, lead, analysis);
  if (replyDraft) await repository.createReplyDraftRecord(replyDraft);

  return { inbox, lead, tasks, replyDraft };
}

export interface IngestSnsInquiriesResult {
  processed: number;
  hotLeadNotifications: string[];
  errors: string[];
}

/**
 * 複数のSNS反響をまとめて取り込む。hotリードは即時通知（dry-run）へ回す。
 */
export async function ingestSnsInquiries(
  repository: Repository,
  inquiries: SnsInquiryInput[],
  provider?: AIProvider
): Promise<IngestSnsInquiriesResult> {
  const lineworks = createLineworksConnector();
  const hotLeadNotifications: string[] = [];
  const errors: string[] = [];
  let processed = 0;

  for (const inquiry of inquiries) {
    try {
      const bundle = await ingestSnsInquiry(repository, inquiry, provider);
      processed += 1;
      if (bundle.lead.temperature === 'hot' && !bundle.lead.isSpam) {
        const value = bundle.lead.estimatedValueYen
          ? `／見込み約${Math.round(bundle.lead.estimatedValueYen / 10_000)}万円`
          : '';
        const text = `【SNS反響・当日返信】${bundle.lead.channel} ${bundle.lead.displayName || bundle.lead.accountName}${value}\n${bundle.lead.summary}`;
        hotLeadNotifications.push(text);
        await lineworks.sendNotification(text);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { processed, hotLeadNotifications, errors };
}

export interface FollowUpLeadsResult {
  /** 生成した追客タスク */
  tasks: TaskRecord[];
  /** 自動追客の上限に達して長期フォローへ移したリードID */
  movedToNurturing: string[];
}

/**
 * 追客日を過ぎた進行中リードに、追客タスクを自動生成する。
 * 上限回数に達したリードは長期フォロー（nurturing）へ落として自動追客を止める。
 */
export async function followUpLeads(
  repository: Repository,
  now = new Date()
): Promise<FollowUpLeadsResult> {
  const today = todayIsoDate(now);
  const leads = await repository.getOpenLeads();
  const due = leads.filter((lead) => lead.followUpDate !== null && lead.followUpDate <= today);

  const tasks: TaskRecord[] = [];
  const movedToNurturing: string[] = [];

  for (const lead of due) {
    if (lead.followUpCount >= MAX_FOLLOW_UP_COUNT) {
      await repository.updateLeadRecord(lead.id, { stage: 'nurturing', followUpDate: null });
      movedToNurturing.push(lead.id);
      continue;
    }

    const count = lead.followUpCount + 1;
    const timestamp = nowIso();
    tasks.push({
      id: randomUUID(),
      sourceInboxId: lead.sourceInboxId,
      taskTitle: `追客${count}回目（${lead.displayName || lead.accountName}）`,
      taskDetail: [
        `${BUSINESS_LINE_LABELS[lead.businessLine]}／確度${lead.leadScore}／${lead.channel}`,
        `前回状況: ${lead.nextAction}`,
        lead.missingInfo.length > 0 ? `未確認: ${lead.missingInfo.slice(0, 3).join('、')}` : ''
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
      ownerType: lead.ownerType,
      ownerName: '',
      dueDate: today,
      dueDateText: '今日中',
      priority: lead.temperature === 'hot' ? 'A' : 'B',
      projectName: lead.area ? `${lead.area}${BUSINESS_LINE_LABELS[lead.businessLine]}案件` : '',
      customerName: lead.displayName || lead.accountName,
      nextAction:
        lead.stage === 'estimating' || lead.stage === 'proposed'
          ? '提出済みの見積について、検討状況と不明点を確認する'
          : '前回のヒアリング内容を踏まえ、現地調査の日程を提案する',
      requiresPresident: false,
      status: 'todo',
      reason: `追客予定日（${lead.followUpDate}）を過ぎています。`,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await repository.updateLeadRecord(lead.id, {
      followUpCount: count,
      followUpDate: shiftIsoDate(today, FOLLOW_UP_INTERVAL_DAYS[lead.temperature])
    });
  }

  if (tasks.length > 0) {
    await repository.createTaskRecords(tasks);
  }

  return { tasks, movedToNurturing };
}
