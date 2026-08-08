/**
 * LCC COMMAND リポジトリ。
 *
 * 読み取り正本（案件・原価・請求・資金繰り等）は Phase A ではシードデータが代替し、
 * Phase B で既存正本（会計・銀行・CRM・Google Workspace）への
 * Read接続に置き換える。ここで永続化するのは LCC COMMAND 自身が正本となる
 * 経営判断Memory・タスク・承認・外部Researchの4種のみ。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ApprovalRequest, CommandTask, Decision, ResearchTask } from '../domain/types.js';
import type { ExperimentRecord, MemoryRecord } from '../memory/types.js';
import { buildSeedDataset, type CommandDataset } from '../data/seed.js';
import {
  DemoSourceRegistry,
  ProductionSourceRegistry,
  type SourceRegistry
} from '../sources/SourceAdapter.js';
import { createSheetsRegistryFromEnv } from '../sources/googleSheets.js';

export interface CommandStore {
  decisions: Decision[];
  tasks: CommandTask[];
  approvals: ApprovalRequest[];
  research: ResearchTask[];
  /** Persistent Memory（Phase M）。物理削除しない */
  memories: MemoryRecord[];
  experiments: ExperimentRecord[];
}

export interface CommandRepository {
  /** demo: Demo Fixture由来 / production: 実ソース由来（未接続ならデータ空＋errorState） */
  readonly mode: 'demo' | 'production';
  /** 基準日時点の読み取りデータセット（正本の横断ビュー）を返す */
  getDataset(asOf: string): Promise<CommandDataset>;
  getStore(): Promise<CommandStore>;
  saveDecision(decision: Decision): Promise<Decision>;
  saveTask(task: CommandTask): Promise<CommandTask>;
  saveApproval(approval: ApprovalRequest): Promise<ApprovalRequest>;
  updateApproval(
    approvalId: string,
    patch: Partial<ApprovalRequest>
  ): Promise<ApprovalRequest | null>;
  saveResearch(task: ResearchTask): Promise<ResearchTask>;
  getMemories(): Promise<MemoryRecord[]>;
  saveMemory(record: MemoryRecord): Promise<MemoryRecord>;
  getExperiments(): Promise<ExperimentRecord[]>;
  saveExperiment(record: ExperimentRecord): Promise<ExperimentRecord>;
}

function defaultStore(): CommandStore {
  return { decisions: [], tasks: [], approvals: [], research: [], memories: [], experiments: [] };
}

export class LocalCommandRepository implements CommandRepository {
  private readonly dbPath: string;
  private readonly registry: SourceRegistry;

  constructor(
    dbPath = process.env.LCC_COMMAND_DB_PATH ?? './data/lcc-command-local.json',
    registry: SourceRegistry = new DemoSourceRegistry()
  ) {
    this.dbPath = resolve(dbPath);
    this.registry = registry;
  }

  get mode(): 'demo' | 'production' {
    return this.registry.mode;
  }

  private async readStore(): Promise<CommandStore> {
    try {
      const content = await readFile(this.dbPath, 'utf8');
      return { ...defaultStore(), ...(JSON.parse(content) as Partial<CommandStore>) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultStore();
      throw error;
    }
  }

  private async writeStore(store: CommandStore): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    await writeFile(this.dbPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  }

  async getDataset(asOf: string): Promise<CommandDataset> {
    // Demo Fixture隔離: productionモードのRegistryはデモデータへフォールバックしない
    return this.registry.compose(asOf);
  }

  async getStore(): Promise<CommandStore> {
    return this.readStore();
  }

  async saveDecision(decision: Decision): Promise<Decision> {
    const store = await this.readStore();
    store.decisions = [
      ...store.decisions.filter((item) => item.decisionId !== decision.decisionId),
      decision
    ];
    await this.writeStore(store);
    return decision;
  }

  async saveTask(task: CommandTask): Promise<CommandTask> {
    const store = await this.readStore();
    store.tasks = [...store.tasks.filter((item) => item.taskId !== task.taskId), task];
    await this.writeStore(store);
    return task;
  }

  async saveApproval(approval: ApprovalRequest): Promise<ApprovalRequest> {
    const store = await this.readStore();
    store.approvals = [
      ...store.approvals.filter((item) => item.approvalId !== approval.approvalId),
      approval
    ];
    await this.writeStore(store);
    return approval;
  }

  async updateApproval(
    approvalId: string,
    patch: Partial<ApprovalRequest>
  ): Promise<ApprovalRequest | null> {
    const store = await this.readStore();
    const approval = store.approvals.find((item) => item.approvalId === approvalId);
    if (!approval) return null;
    Object.assign(approval, patch);
    await this.writeStore(store);
    return approval;
  }

  async saveResearch(task: ResearchTask): Promise<ResearchTask> {
    const store = await this.readStore();
    store.research = [
      ...store.research.filter((item) => item.researchId !== task.researchId),
      task
    ];
    await this.writeStore(store);
    return task;
  }

  async getMemories(): Promise<MemoryRecord[]> {
    return (await this.readStore()).memories;
  }

  async saveMemory(record: MemoryRecord): Promise<MemoryRecord> {
    const store = await this.readStore();
    store.memories = [...store.memories.filter((m) => m.memoryId !== record.memoryId), record];
    await this.writeStore(store);
    return record;
  }

  async getExperiments(): Promise<ExperimentRecord[]> {
    return (await this.readStore()).experiments;
  }

  async saveExperiment(record: ExperimentRecord): Promise<ExperimentRecord> {
    const store = await this.readStore();
    store.experiments = [
      ...store.experiments.filter((e) => e.experimentId !== record.experimentId),
      record
    ];
    await this.writeStore(store);
    return record;
  }
}

/** テスト用: メモリ上のみで動くリポジトリ */
/**
 * モードに応じたリポジトリを生成する。
 * LCC_COMMAND_MODE=production では ProductionSourceRegistry（実Adapter未設定なら
 * DATA UNAVAILABLE）を使い、デモデータへは決してフォールバックしない。
 */
export function createCommandRepository(
  mode: 'demo' | 'production' = (process.env.LCC_COMMAND_MODE as 'demo' | 'production') ?? 'demo'
): CommandRepository {
  // production: Sheets Source設定があれば実データREAD ONLY接続、なければ未接続（DATA UNAVAILABLE）。
  // どちらの場合もデモデータへはフォールバックしない。
  const registry: SourceRegistry =
    mode === 'production'
      ? (createSheetsRegistryFromEnv() ?? new ProductionSourceRegistry())
      : new DemoSourceRegistry();
  return new LocalCommandRepository(undefined, registry);
}

export class InMemoryCommandRepository implements CommandRepository {
  private store: CommandStore = defaultStore();

  constructor(
    private readonly datasetFactory: (asOf: string) => CommandDataset = buildSeedDataset,
    readonly mode: 'demo' | 'production' = 'demo'
  ) {}

  async getDataset(asOf: string): Promise<CommandDataset> {
    return this.datasetFactory(asOf);
  }

  async getStore(): Promise<CommandStore> {
    return this.store;
  }

  async saveDecision(decision: Decision): Promise<Decision> {
    this.store.decisions = [
      ...this.store.decisions.filter((item) => item.decisionId !== decision.decisionId),
      decision
    ];
    return decision;
  }

  async saveTask(task: CommandTask): Promise<CommandTask> {
    this.store.tasks = [...this.store.tasks.filter((item) => item.taskId !== task.taskId), task];
    return task;
  }

  async saveApproval(approval: ApprovalRequest): Promise<ApprovalRequest> {
    this.store.approvals = [
      ...this.store.approvals.filter((item) => item.approvalId !== approval.approvalId),
      approval
    ];
    return approval;
  }

  async updateApproval(
    approvalId: string,
    patch: Partial<ApprovalRequest>
  ): Promise<ApprovalRequest | null> {
    const approval = this.store.approvals.find((item) => item.approvalId === approvalId);
    if (!approval) return null;
    Object.assign(approval, patch);
    return approval;
  }

  async saveResearch(task: ResearchTask): Promise<ResearchTask> {
    this.store.research = [
      ...this.store.research.filter((item) => item.researchId !== task.researchId),
      task
    ];
    return task;
  }

  async getMemories(): Promise<MemoryRecord[]> {
    return this.store.memories;
  }

  async saveMemory(record: MemoryRecord): Promise<MemoryRecord> {
    this.store.memories = [
      ...this.store.memories.filter((m) => m.memoryId !== record.memoryId),
      record
    ];
    return record;
  }

  async getExperiments(): Promise<ExperimentRecord[]> {
    return this.store.experiments;
  }

  async saveExperiment(record: ExperimentRecord): Promise<ExperimentRecord> {
    this.store.experiments = [
      ...this.store.experiments.filter((e) => e.experimentId !== record.experimentId),
      record
    ];
    return record;
  }
}
