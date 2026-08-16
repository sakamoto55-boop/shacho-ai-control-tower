import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isOpenLeadStage } from '../domain/leadRules.js';
import type {
  InboxRecord,
  LeadRecord,
  ReplyDraftRecord,
  SnsPostDraftRecord,
  TaskRecord
} from '../domain/types.js';
import { nowIso } from '../utils/date.js';
import type { DateRange, Repository } from './Repository.js';

interface LocalDb {
  inbox: InboxRecord[];
  tasks: TaskRecord[];
  replyDrafts: ReplyDraftRecord[];
  leads: LeadRecord[];
  snsPostDrafts: SnsPostDraftRecord[];
}

function defaultDb(): LocalDb {
  return { inbox: [], tasks: [], replyDrafts: [], leads: [], snsPostDrafts: [] };
}

function withinRange(receivedAt: string, range?: DateRange): boolean {
  if (!range) return true;
  if (range.from && receivedAt < range.from) return false;
  if (range.to && receivedAt > range.to) return false;
  return true;
}

export class LocalRepository implements Repository {
  private readonly dbPath: string;

  constructor(dbPath = process.env.LOCAL_DB_PATH ?? './data/shacho-ai-local.json') {
    this.dbPath = resolve(dbPath);
  }

  private async readDb(): Promise<LocalDb> {
    try {
      const content = await readFile(this.dbPath, 'utf8');
      // SNS集客の追加前に作られたJSONにはleads/snsPostDraftsが無いため、既定値で補う。
      return { ...defaultDb(), ...(JSON.parse(content) as Partial<LocalDb>) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultDb();
      throw error;
    }
  }

  private async writeDb(db: LocalDb): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    await writeFile(this.dbPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  }

  async createInboxRecord(record: InboxRecord): Promise<InboxRecord> {
    const db = await this.readDb();
    const existing = db.inbox.find(
      (item) =>
        item.source === record.source &&
        item.externalMessageId &&
        record.externalMessageId &&
        item.externalMessageId === record.externalMessageId
    );
    if (existing) return existing;
    db.inbox.push(record);
    await this.writeDb(db);
    return record;
  }

  async createTaskRecords(records: TaskRecord[]): Promise<TaskRecord[]> {
    const db = await this.readDb();
    db.tasks.push(...records);
    await this.writeDb(db);
    return records;
  }

  async createReplyDraftRecord(record: ReplyDraftRecord): Promise<ReplyDraftRecord> {
    const db = await this.readDb();
    db.replyDrafts.push(record);
    await this.writeDb(db);
    return record;
  }

  async updateInboxStatus(id: string, status: InboxRecord['status']): Promise<InboxRecord | null> {
    const db = await this.readDb();
    const record = db.inbox.find((item) => item.id === id);
    if (!record) return null;
    record.status = status;
    record.updatedAt = nowIso();
    await this.writeDb(db);
    return record;
  }

  async getUnreviewedInboxRecords(): Promise<InboxRecord[]> {
    const db = await this.readDb();
    return db.inbox.filter((item) => item.status === 'unreviewed');
  }

  async getOpenTasks(): Promise<TaskRecord[]> {
    const db = await this.readDb();
    return db.tasks.filter((item) => ['todo', 'doing', 'pending'].includes(item.status));
  }

  async getWaitingReplyDrafts(): Promise<ReplyDraftRecord[]> {
    const db = await this.readDb();
    return db.replyDrafts.filter((item) => item.approvalStatus === 'waiting');
  }

  async getInboxRecordsByDateRange(range?: DateRange): Promise<InboxRecord[]> {
    const db = await this.readDb();
    return db.inbox.filter((item) => withinRange(item.receivedAt, range));
  }

  async getTasksByDateRange(range?: DateRange): Promise<TaskRecord[]> {
    const db = await this.readDb();
    return db.tasks.filter((item) => withinRange(item.createdAt, range));
  }

  async getReplyDraftsByDateRange(range?: DateRange): Promise<ReplyDraftRecord[]> {
    const db = await this.readDb();
    return db.replyDrafts.filter((item) => withinRange(item.createdAt, range));
  }

  async createLeadRecord(record: LeadRecord): Promise<LeadRecord> {
    const db = await this.readDb();
    const existing = db.leads.find(
      (item) =>
        item.channel === record.channel &&
        item.externalInquiryId.length > 0 &&
        item.externalInquiryId === record.externalInquiryId
    );
    if (existing) return existing;
    db.leads.push(record);
    await this.writeDb(db);
    return record;
  }

  async updateLeadRecord(id: string, patch: Partial<LeadRecord>): Promise<LeadRecord | null> {
    const db = await this.readDb();
    const index = db.leads.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const updated: LeadRecord = { ...db.leads[index], ...patch, id, updatedAt: nowIso() };
    db.leads[index] = updated;
    await this.writeDb(db);
    return updated;
  }

  async getLeadsByDateRange(range?: DateRange): Promise<LeadRecord[]> {
    const db = await this.readDb();
    return db.leads.filter((item) => withinRange(item.receivedAt, range));
  }

  async getOpenLeads(): Promise<LeadRecord[]> {
    const db = await this.readDb();
    return db.leads.filter((item) => !item.isSpam && isOpenLeadStage(item.stage));
  }

  async createSnsPostDraftRecords(records: SnsPostDraftRecord[]): Promise<SnsPostDraftRecord[]> {
    const db = await this.readDb();
    // 同じチャンネル・同じ日時の枠を二重に埋めない
    const isDuplicate = (record: SnsPostDraftRecord) =>
      db.snsPostDrafts.some(
        (item) =>
          item.channel === record.channel &&
          item.scheduledDate === record.scheduledDate &&
          item.scheduledTime === record.scheduledTime
      );
    const created = records.filter((record) => !isDuplicate(record));
    if (created.length === 0) return [];
    db.snsPostDrafts.push(...created);
    await this.writeDb(db);
    return created;
  }

  async updateSnsPostDraftRecord(
    id: string,
    patch: Partial<SnsPostDraftRecord>
  ): Promise<SnsPostDraftRecord | null> {
    const db = await this.readDb();
    const index = db.snsPostDrafts.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const updated: SnsPostDraftRecord = {
      ...db.snsPostDrafts[index],
      ...patch,
      id,
      updatedAt: nowIso()
    };
    db.snsPostDrafts[index] = updated;
    await this.writeDb(db);
    return updated;
  }

  async getSnsPostDraftsByDateRange(range?: DateRange): Promise<SnsPostDraftRecord[]> {
    const db = await this.readDb();
    return db.snsPostDrafts.filter((item) => withinRange(item.scheduledDate, range));
  }
}
