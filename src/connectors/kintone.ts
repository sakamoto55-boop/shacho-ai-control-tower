import type { InboxRecord, ReplyDraftRecord, TaskRecord } from '../domain/types.js';

export const KINTONE_FIELD_CODES = {
  inbox: {
    source: 'source',
    receivedAt: 'receivedAt',
    senderName: 'senderName',
    senderAddress: 'senderAddress',
    roomName: 'roomName',
    subject: 'subject',
    originalText: 'originalText',
    summary: 'summary',
    projectName: 'projectName',
    customerName: 'customerName',
    priority: 'priority',
    replyNeeded: 'replyNeeded',
    riskType: 'riskType',
    riskLevel: 'riskLevel',
    confidence: 'confidence',
    status: 'status'
  },
  task: {
    sourceInboxId: 'sourceInboxId',
    taskTitle: 'taskTitle',
    taskDetail: 'taskDetail',
    ownerType: 'ownerType',
    ownerName: 'ownerName',
    dueDate: 'dueDate',
    dueDateText: 'dueDateText',
    priority: 'priority',
    projectName: 'projectName',
    customerName: 'customerName',
    nextAction: 'nextAction',
    requiresPresident: 'requiresPresident',
    status: 'status',
    reason: 'reason'
  },
  replyDraft: {
    sourceInboxId: 'sourceInboxId',
    recipientName: 'recipientName',
    recipientAddress: 'recipientAddress',
    draftText: 'draftText',
    tone: 'tone',
    confirmationNeeded: 'confirmationNeeded',
    ngReasons: 'ngReasons',
    approvalStatus: 'approvalStatus'
  }
} as const;

type KintoneFieldValue = { value: string | string[] | boolean | null };
type KintoneRecordPayload = Record<string, KintoneFieldValue>;

export function toKintoneInboxPayload(record: InboxRecord): KintoneRecordPayload {
  return {
    [KINTONE_FIELD_CODES.inbox.source]: { value: record.source },
    [KINTONE_FIELD_CODES.inbox.receivedAt]: { value: record.receivedAt },
    [KINTONE_FIELD_CODES.inbox.senderName]: { value: record.senderName },
    [KINTONE_FIELD_CODES.inbox.senderAddress]: { value: record.senderAddress },
    [KINTONE_FIELD_CODES.inbox.roomName]: { value: record.roomName },
    [KINTONE_FIELD_CODES.inbox.subject]: { value: record.subject },
    [KINTONE_FIELD_CODES.inbox.originalText]: { value: record.originalText },
    [KINTONE_FIELD_CODES.inbox.summary]: { value: record.summary },
    [KINTONE_FIELD_CODES.inbox.projectName]: { value: record.projectName },
    [KINTONE_FIELD_CODES.inbox.customerName]: { value: record.customerName },
    [KINTONE_FIELD_CODES.inbox.priority]: { value: record.priority },
    [KINTONE_FIELD_CODES.inbox.replyNeeded]: { value: record.replyNeeded },
    [KINTONE_FIELD_CODES.inbox.riskType]: { value: record.riskType },
    [KINTONE_FIELD_CODES.inbox.riskLevel]: { value: record.riskLevel },
    [KINTONE_FIELD_CODES.inbox.confidence]: { value: record.confidence },
    [KINTONE_FIELD_CODES.inbox.status]: { value: record.status }
  };
}

export function toKintoneTaskPayload(record: TaskRecord): KintoneRecordPayload {
  return {
    [KINTONE_FIELD_CODES.task.sourceInboxId]: { value: record.sourceInboxId },
    [KINTONE_FIELD_CODES.task.taskTitle]: { value: record.taskTitle },
    [KINTONE_FIELD_CODES.task.taskDetail]: { value: record.taskDetail },
    [KINTONE_FIELD_CODES.task.ownerType]: { value: record.ownerType },
    [KINTONE_FIELD_CODES.task.ownerName]: { value: record.ownerName },
    [KINTONE_FIELD_CODES.task.dueDate]: { value: record.dueDate },
    [KINTONE_FIELD_CODES.task.dueDateText]: { value: record.dueDateText },
    [KINTONE_FIELD_CODES.task.priority]: { value: record.priority },
    [KINTONE_FIELD_CODES.task.projectName]: { value: record.projectName },
    [KINTONE_FIELD_CODES.task.customerName]: { value: record.customerName },
    [KINTONE_FIELD_CODES.task.nextAction]: { value: record.nextAction },
    [KINTONE_FIELD_CODES.task.requiresPresident]: { value: record.requiresPresident },
    [KINTONE_FIELD_CODES.task.status]: { value: record.status },
    [KINTONE_FIELD_CODES.task.reason]: { value: record.reason }
  };
}

export function toKintoneReplyDraftPayload(record: ReplyDraftRecord): KintoneRecordPayload {
  return {
    [KINTONE_FIELD_CODES.replyDraft.sourceInboxId]: { value: record.sourceInboxId },
    [KINTONE_FIELD_CODES.replyDraft.recipientName]: { value: record.recipientName },
    [KINTONE_FIELD_CODES.replyDraft.recipientAddress]: { value: record.recipientAddress },
    [KINTONE_FIELD_CODES.replyDraft.draftText]: { value: record.draftText },
    [KINTONE_FIELD_CODES.replyDraft.tone]: { value: record.tone },
    [KINTONE_FIELD_CODES.replyDraft.confirmationNeeded]: { value: record.confirmationNeeded },
    [KINTONE_FIELD_CODES.replyDraft.ngReasons]: { value: record.ngReasons },
    [KINTONE_FIELD_CODES.replyDraft.approvalStatus]: { value: record.approvalStatus }
  };
}
