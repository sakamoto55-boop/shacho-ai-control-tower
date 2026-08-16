import type {
  InboxRecord,
  LeadRecord,
  ReplyDraftRecord,
  SnsPostDraftRecord,
  TaskRecord
} from '../domain/types.js';

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

  /* SNS集客・収益化 */
  createLeadRecord(record: LeadRecord): Promise<LeadRecord>;
  updateLeadRecord(id: string, patch: Partial<LeadRecord>): Promise<LeadRecord | null>;
  getLeadsByDateRange(range?: DateRange): Promise<LeadRecord[]>;
  getOpenLeads(): Promise<LeadRecord[]>;
  createSnsPostDraftRecords(records: SnsPostDraftRecord[]): Promise<SnsPostDraftRecord[]>;
  updateSnsPostDraftRecord(
    id: string,
    patch: Partial<SnsPostDraftRecord>
  ): Promise<SnsPostDraftRecord | null>;
  getSnsPostDraftsByDateRange(range?: DateRange): Promise<SnsPostDraftRecord[]>;
}
