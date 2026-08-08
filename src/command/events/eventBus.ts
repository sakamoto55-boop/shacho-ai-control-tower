/**
 * Visual Intelligence Event Bus（Phase B1.5 §18-§21・§28）。
 *
 * Phase VUI（粒子AI CORE・Agent Activity可視化・Voice）へ内部状態を通知する基盤。
 * - UIはProvider名ではなくRoleを基本表示する（displayLabelはRole/状態の安全な日本語）。
 * - 給与・口座・個人情報・メール本文などをEventへ流さない（IDとdisplayLabelのみ）。
 * - Event Busはリングバッファ + subscribe（Phase VUIでSSE/WebSocketへ接続する）。
 */

export type CommandEventType =
  | 'AI_IDLE'
  | 'USER_SPEAKING'
  | 'AI_LISTENING'
  | 'AI_THINKING'
  | 'PLAN_CREATED'
  | 'ROLE_STARTED'
  | 'ROLE_COMPLETED'
  | 'TOOL_STARTED'
  | 'TOOL_COMPLETED'
  | 'RESEARCH_STARTED'
  | 'RESEARCH_COMPLETED'
  | 'MEMORY_RECALL'
  | 'MEMORY_UPDATED'
  | 'CRITIC_STARTED'
  | 'CRITIC_COMPLETED'
  | 'INNOVATION_STARTED'
  | 'EXECUTION_PROPOSED'
  | 'APPROVAL_REQUIRED'
  | 'ANSWER_STREAMING'
  | 'ANSWER_COMPLETED'
  | 'WARNING'
  | 'ERROR';

export interface CommandEvent {
  event: CommandEventType;
  timestamp: string;
  sessionId?: string;
  planId?: string;
  taskId?: string;
  /** 内部Role名（UIはこれをアイコン/発光方向の選択に使う） */
  role?: string;
  /** UI表示用の安全な日本語ラベル（機微情報・本文を含めない） */
  displayLabel?: string;
}

/** AI COREの中央状態（§20）。複数Role並列時はprimaryState + activeRoles[] */
export type AiCoreState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'SEARCHING'
  | 'ANALYZING'
  | 'RESEARCHING'
  | 'REMEMBERING'
  | 'CRITIQUING'
  | 'INNOVATING'
  | 'WAITING_APPROVAL'
  | 'RESPONDING'
  | 'WARNING'
  | 'ERROR';

export interface AiCoreStatus {
  primaryState: AiCoreState;
  activeRoles: string[];
  updatedAt: string;
}

const EVENT_TO_STATE: Partial<Record<CommandEventType, AiCoreState>> = {
  AI_IDLE: 'IDLE',
  USER_SPEAKING: 'LISTENING',
  AI_LISTENING: 'LISTENING',
  AI_THINKING: 'THINKING',
  PLAN_CREATED: 'THINKING',
  TOOL_STARTED: 'SEARCHING',
  TOOL_COMPLETED: 'ANALYZING',
  RESEARCH_STARTED: 'RESEARCHING',
  RESEARCH_COMPLETED: 'ANALYZING',
  MEMORY_RECALL: 'REMEMBERING',
  MEMORY_UPDATED: 'REMEMBERING',
  CRITIC_STARTED: 'CRITIQUING',
  CRITIC_COMPLETED: 'ANALYZING',
  INNOVATION_STARTED: 'INNOVATING',
  EXECUTION_PROPOSED: 'WAITING_APPROVAL',
  APPROVAL_REQUIRED: 'WAITING_APPROVAL',
  ANSWER_STREAMING: 'RESPONDING',
  ANSWER_COMPLETED: 'IDLE',
  WARNING: 'WARNING',
  ERROR: 'ERROR'
};

const MAX_EVENTS = 500;

export class CommandEventBus {
  private readonly events: CommandEvent[] = [];
  private readonly listeners = new Set<(event: CommandEvent) => void>();
  private readonly activeRoles = new Set<string>();
  private lastState: AiCoreState = 'IDLE';
  private lastUpdatedAt = '';

  emit(event: Omit<CommandEvent, 'timestamp'> & { timestamp?: string }): CommandEvent {
    const full: CommandEvent = { timestamp: new Date().toISOString(), ...event };
    this.events.push(full);
    if (this.events.length > MAX_EVENTS) this.events.shift();

    if (full.event === 'ROLE_STARTED' && full.role) this.activeRoles.add(full.role);
    if (full.event === 'ROLE_COMPLETED' && full.role) this.activeRoles.delete(full.role);
    if (full.event === 'ANSWER_COMPLETED' || full.event === 'AI_IDLE') this.activeRoles.clear();
    const state = EVENT_TO_STATE[full.event];
    if (state) {
      this.lastState = state;
      this.lastUpdatedAt = full.timestamp;
    }

    for (const listener of this.listeners) {
      try {
        listener(full);
      } catch {
        // リスナー例外でBusを止めない
      }
    }
    return full;
  }

  subscribe(listener: (event: CommandEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(limit = 100): CommandEvent[] {
    return this.events.slice(-limit);
  }

  coreState(): AiCoreStatus {
    return {
      primaryState: this.lastState,
      activeRoles: [...this.activeRoles],
      updatedAt: this.lastUpdatedAt
    };
  }
}

/** Role → UI表示ラベル（§19。Provider名は使わない） */
export const ROLE_DISPLAY_LABELS: Record<string, string> = {
  STRATEGY: '戦略を検討中',
  FINANCE: '資金状況を分析中',
  SALES: '営業状況を分析中',
  OPERATIONS: '現場状況を確認中',
  ANALYSIS: 'データを分析中',
  RESEARCH: '外部情報を調査中',
  MEMORY: '記憶を参照中',
  CRITIC: '回答を検証中',
  INNOVATION: '新しい案を構想中',
  WRITING: '文章を作成中',
  LEGAL_CHECK: '法的観点を確認中',
  HR: '人事観点を確認中',
  SYNTHESIS: '回答をまとめ中'
};
