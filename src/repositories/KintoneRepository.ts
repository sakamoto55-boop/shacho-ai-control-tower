import type { InboxRecord, ReplyDraftRecord, TaskRecord } from '../domain/types.js';
import type { DateRange, Repository } from './Repository.js';

export class KintoneRepository implements Repository {
  constructor() {
    if (!process.env.KINTONE_BASE_URL || !process.env.KINTONE_API_TOKEN) {
      throw new Error('KintoneRepository requires KINTONE_BASE_URL and KINTONE_API_TOKEN.');
    }
  }

  async createInboxRecord(_record: InboxRecord): Promise<InboxRecord> {
    throw new Error('KintoneRepository is a Phase 1 connector stub. Use LocalRepository for MVP.');
  }

  async createTaskRecords(_records: TaskRecord[]): Promise<TaskRecord[]> {
    throw new Error('KintoneRepository is a Phase 1 connector stub. Use LocalRepository for MVP.');
  }

  async createReplyDraftRecord(_record: ReplyDraftRecord): Promise<ReplyDraftRecord> {
    throw new Error('KintoneRepository is a Phase 1 connector stub. Use LocalRepository for MVP.');
  }

  async updateInboxStatus(_id: string, _status: InboxRecord['status']): Promise<InboxRecord | null> {
    throw new Error('KintoneRepository is a Phase 1 connector stub. Use LocalRepository for MVP.');
  }

  async getUnreviewedInboxRecords(): Promise<InboxRecord[]> {
    throw new Error('KintoneRepository is a Phase 1 connector stub. Use LocalRepository for MVP.');
  }

  async getOpenTasks(): Promise<TaskRecord[]> {
    throw new Error('KintoneRepository is a Phase 1 connector stub. Use LocalRepository for MVP.');
  }

  async getWaitingReplyDrafts(): Promise<ReplyDraftRecord[]> {
    throw new Error('KintoneRepository is a Phase 1 connector stub. Use LocalRepository for MVP.');
  }

  async getInboxRecordsByDateRange(_range?: DateRange): Promise<InboxRecord[]> {
    throw new Error('KintoneRepository is a Phase 1 connector stub. Use LocalRepository for MVP.');
  }

  async getTasksByDateRange(_range?: DateRange): Promise<TaskRecord[]> {
    throw new Error('KintoneRepository is a Phase 1 connector stub. Use LocalRepository for MVP.');
  }

  async getReplyDraftsByDateRange(_range?: DateRange): Promise<ReplyDraftRecord[]> {
    throw new Error('KintoneRepository is a Phase 1 connector stub. Use LocalRepository for MVP.');
  }
}
