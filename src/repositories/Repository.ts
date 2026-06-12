import type { InboxRecord, ReplyDraftRecord, TaskRecord } from '../domain/types.js';

export interface DateRange {
  from?: string;
  to?: string;
}

export interface Repository {
  createInboxRecord(record: InboxRecord): Promise<InboxRecord>;
  createTaskRecords(records: TaskRecord[]): Promise<TaskRecord[]>;
  createReplyDraftRecord(record: ReplyDraftRecord): Promise<ReplyDraftRecord>;
  updateInboxStatus(id: string, status: InboxRecord['status']): Promise<InboxRecord | null>;
  getUnreviewedInboxRecords(): Promise<InboxRecord[]>;
  getOpenTasks(): Promise<TaskRecord[]>;
  getWaitingReplyDrafts(): Promise<ReplyDraftRecord[]>;
  getInboxRecordsByDateRange(range?: DateRange): Promise<InboxRecord[]>;
  getTasksByDateRange(range?: DateRange): Promise<TaskRecord[]>;
  getReplyDraftsByDateRange(range?: DateRange): Promise<ReplyDraftRecord[]>;
}
