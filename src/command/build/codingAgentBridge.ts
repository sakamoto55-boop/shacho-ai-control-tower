/**
 * Coding Agent Bridge（Phase LIVE-AI §25-§28）。
 *
 * SOFTWARE_ENGINEERING Provider Adapterの定義。特定のCoding Agentへハードコードしない。
 * - Buildは必ず 重複チェック→現行フロー→要件→Constitution照合 の後に開始する（§25）
 * - アプリ開発はLong Running Task（PLANNING〜COMPLETED・§27）
 * - テスト・Critic・Security・Human Approvalなしで本番Deployしない（§28）
 */

export interface CodingTaskSpec {
  requirements: string;
  repositoryContext?: string;
  acceptanceTests: string[];
  safetyRules: string[];
}

/** Coding Agentの抽象。利用可能なAgent（Claude Code等）が接続されたら実装を登録する */
export interface CodingAgentAdapter {
  agentId: string;
  submitTask(spec: CodingTaskSpec): Promise<{ taskRef: string }>;
}

export type BuildTaskStatus =
  | 'PLANNING'
  | 'BUILDING'
  | 'TESTING'
  | 'REVIEW'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED';

export interface BuildTask {
  buildId: string;
  title: string;
  status: BuildTaskStatus;
  createdAt: string;
  updatedAt: string;
  history: Array<{ status: BuildTaskStatus; at: string; note?: string }>;
  approvedBy?: string;
  agentTaskRef?: string;
}

const ORDER: BuildTaskStatus[] = ['PLANNING', 'BUILDING', 'TESTING', 'REVIEW', 'WAITING_APPROVAL', 'COMPLETED'];

let buildSeq = 0;
export function resetBuildSeq(): void {
  buildSeq = 0;
}

/** Build Taskライフサイクル管理。承認なしでCOMPLETED（=Deploy可）へ進めない */
export class BuildTaskManager {
  private readonly tasks = new Map<string, BuildTask>();

  constructor(private readonly agent: CodingAgentAdapter | null = null) {}

  get agentConfigured(): boolean {
    return this.agent !== null;
  }

  create(title: string, now: string): BuildTask {
    buildSeq += 1;
    const task: BuildTask = {
      buildId: `build-${String(buildSeq).padStart(3, '0')}`,
      title,
      status: 'PLANNING',
      createdAt: now,
      updatedAt: now,
      history: [{ status: 'PLANNING', at: now }]
    };
    this.tasks.set(task.buildId, task);
    return task;
  }

  get(buildId: string): BuildTask | undefined {
    return this.tasks.get(buildId);
  }

  list(): BuildTask[] {
    return [...this.tasks.values()];
  }

  /**
   * 次ステータスへ進める。WAITING_APPROVAL→COMPLETEDは approvedBy 必須（§28: 自動Deploy禁止）。
   */
  advance(buildId: string, now: string, options: { approvedBy?: string; note?: string } = {}): BuildTask {
    const task = this.tasks.get(buildId);
    if (!task) throw new Error(`BuildTask ${buildId} が見つかりません`);
    const index = ORDER.indexOf(task.status);
    if (index < 0 || index === ORDER.length - 1) return task;
    const next = ORDER[index + 1];
    if (next === 'COMPLETED' && !options.approvedBy) {
      throw new Error('本番Deploy（COMPLETED）には人間の承認（approvedBy）が必須です。自動Deployは禁止されています');
    }
    task.status = next;
    task.updatedAt = now;
    if (options.approvedBy) task.approvedBy = options.approvedBy;
    task.history.push({ status: next, at: now, note: options.note });
    return task;
  }

  fail(buildId: string, now: string, note: string): BuildTask {
    const task = this.tasks.get(buildId);
    if (!task) throw new Error(`BuildTask ${buildId} が見つかりません`);
    task.status = 'FAILED';
    task.updatedAt = now;
    task.history.push({ status: 'FAILED', at: now, note });
    return task;
  }

  /** Coding Agentが接続済みならタスクを渡す（未接続はNOT_CONFIGUREDとして正直に扱う） */
  async dispatch(buildId: string, spec: CodingTaskSpec): Promise<{ dispatched: boolean; reason?: string }> {
    const task = this.tasks.get(buildId);
    if (!task) throw new Error(`BuildTask ${buildId} が見つかりません`);
    if (!this.agent) {
      return { dispatched: false, reason: 'Coding Agentが未接続です（NOT_CONFIGURED）。設計・要件定義までは完了しています' };
    }
    const { taskRef } = await this.agent.submitTask(spec);
    task.agentTaskRef = taskRef;
    return { dispatched: true };
  }
}
