import { randomUUID } from 'node:crypto';
import { analyzeMessage } from '../ai/analyzeMessage.js';
import type {
  AnalyzeMessageInput,
  AnalyzeMessageResult,
  IncomingMessageInput,
  InboxRecord,
  ReplyDraftRecord,
  StoredMessageBundle,
  TaskRecord
} from '../domain/types.js';
import type { AIProvider } from '../ai/providers/AIProvider.js';
import { createGmailConnector } from '../connectors/gmail.js';
import { createLineworksConnector } from '../connectors/lineworks.js';
import type { Repository } from '../repositories/Repository.js';
import { nowIso } from '../utils/date.js';
import { sha256 } from '../utils/hash.js';
import { normalizeText } from '../utils/textNormalize.js';

export function buildInboxRecord(
  input: AnalyzeMessageInput,
  result: AnalyzeMessageResult
): InboxRecord {
  const now = nowIso();
  const normalizedText = normalizeText(input.text);
  const externalMessageId =
    input.externalMessageId ?? sha256(`${input.source}:${input.receivedAt}:${input.senderName}:${normalizedText}`);

  return {
    id: randomUUID(),
    source: input.source,
    externalMessageId,
    originalChannel: input.originalChannel,
    receivedAt: input.receivedAt,
    senderName: input.senderName,
    senderAddress: input.senderAddress,
    roomName: input.roomName,
    subject: input.subject,
    originalText: input.text,
    normalizedText,
    summary: result.summary,
    projectName: result.projectName,
    customerName: result.customerName,
    priority: result.priority,
    replyNeeded: result.replyNeeded,
    riskType: result.risk.type,
    riskLevel: result.risk.level,
    confidence: result.confidence,
    status: result.replyNeeded ? 'draft_created' : result.tasks.length > 0 ? 'task_created' : 'unreviewed',
    createdAt: now,
    updatedAt: now
  };
}

export function buildTaskRecords(inbox: InboxRecord, result: AnalyzeMessageResult): TaskRecord[] {
  const now = nowIso();
  return result.tasks.map((task) => ({
    id: randomUUID(),
    sourceInboxId: inbox.id,
    taskTitle: task.taskTitle,
    taskDetail: task.taskDetail,
    ownerType: task.ownerType,
    ownerName: task.ownerName,
    dueDate: task.dueDate,
    dueDateText: task.dueDateText,
    priority: task.priority,
    projectName: result.projectName,
    customerName: result.customerName,
    nextAction: task.nextAction,
    requiresPresident: task.requiresPresident,
    status: 'todo',
    reason: task.reason,
    createdAt: now,
    updatedAt: now
  }));
}

export function buildReplyDraftRecord(
  inbox: InboxRecord,
  result: AnalyzeMessageResult
): ReplyDraftRecord | undefined {
  if (!result.replyDraft.needed) return undefined;
  const now = nowIso();
  return {
    id: randomUUID(),
    sourceInboxId: inbox.id,
    recipientName: inbox.senderName,
    recipientAddress: inbox.senderAddress,
    draftText: result.replyDraft.text,
    tone: result.replyDraft.tone,
    confirmationNeeded: result.replyDraft.confirmationNeeded,
    ngReasons: result.replyDraft.ngReasons,
    approvalStatus: 'waiting',
    createdAt: now,
    updatedAt: now
  };
}

export async function analyzeAndSaveMessage(
  repository: Repository,
  input: AnalyzeMessageInput,
  provider?: AIProvider
): Promise<StoredMessageBundle> {
  const result = await analyzeMessage(input, provider);
  const inbox = await repository.createInboxRecord(buildInboxRecord(input, result));
  const tasks = await repository.createTaskRecords(buildTaskRecords(inbox, result));
  const replyDraft = buildReplyDraftRecord(inbox, result);
  if (replyDraft) await repository.createReplyDraftRecord(replyDraft);
  return { inbox, tasks, replyDraft };
}

export interface AnalyzeIncomingMessagesResult {
  processed: number;
  highPriorityNotifications: string[];
  errors: string[];
}

export async function analyzeIncomingMessages(
  repository: Repository,
  messages?: IncomingMessageInput[]
): Promise<AnalyzeIncomingMessagesResult> {
  const errors: string[] = [];
  const highPriorityNotifications: string[] = [];
  const gmail = createGmailConnector();
  const lineworks = createLineworksConnector();
  const sourceMessages = messages ?? [
    ...(await gmail.fetchRecentImportantEmails()),
    ...(await gmail.fetchUnreadEmails())
  ];

  let processed = 0;
  for (const message of sourceMessages) {
    try {
      const bundle = await analyzeAndSaveMessage(repository, message);
      processed += 1;
      if (bundle.inbox.priority === 'A' || bundle.inbox.riskLevel === 'high') {
        const text = `【即時確認】${bundle.inbox.projectName || bundle.inbox.customerName || bundle.inbox.senderName}\n${bundle.inbox.summary}`;
        highPriorityNotifications.push(text);
        await lineworks.sendNotification(text);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { processed, highPriorityNotifications, errors };
}
