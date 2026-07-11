import type {
  InboxRecord,
  Priority,
  ReplyDraftRecord,
  RiskLevel,
  TaskRecord
} from '../domain/types.js';
import type { Repository } from '../repositories/Repository.js';
import { isBeforeDate, isSameDate, todayIsoDate } from '../utils/date.js';
import { generateProblemDigest, type DxCandidate } from './generateProblemDigest.js';

/**
 * ダッシュボード用のサマリーデータ。
 * 「今溜まっているもの」「行動決定」「確認すべきこと」「改善できること」の4視点で集約する。
 */

export interface DashboardInboxItem {
  id: string;
  receivedAt: string;
  source: string;
  roomName: string;
  senderName: string;
  summary: string;
  priority: Priority;
  riskLevel: RiskLevel;
  riskType: string;
  replyNeeded: boolean;
  status: string;
}

export interface DashboardTaskItem {
  id: string;
  taskTitle: string;
  ownerType: string;
  ownerName: string;
  dueDate: string | null;
  dueDateText: string;
  priority: Priority;
  requiresPresident: boolean;
  projectName: string;
  nextAction: string;
}

export interface DashboardDraftItem {
  id: string;
  recipientName: string;
  draftText: string;
  confirmationNeeded: string[];
  createdAt: string;
}

export interface DashboardSummary {
  generatedAt: string;
  tiles: {
    /** 未確認で溜まっている受信 */
    unreviewed: number;
    /** 今日届いた件数 */
    todayReceived: number;
    /** 社長判断が必要（優先度A） */
    presidentDecision: number;
    /** 確認待ちの返信下書き */
    replyDraftWaiting: number;
    /** 未完了タスク */
    openTasks: number;
    /** 期限超過タスク */
    overdue: number;
    /** 高リスク検知 */
    highRisk: number;
  };
  /** 最新の受信（新しい順） */
  realtime: DashboardInboxItem[];
  /** 行動決定：社長判断が必要なもの */
  decisions: {
    inbox: DashboardInboxItem[];
    tasks: DashboardTaskItem[];
    overdueTasks: DashboardTaskItem[];
  };
  /** 確認しなければならないこと */
  confirmations: {
    replyDrafts: DashboardDraftItem[];
    replyNeeded: DashboardInboxItem[];
  };
  /** 改善できること（直近30日の問題集約から） */
  improvements: {
    from: string;
    to: string;
    problemCount: number;
    categories: { label: string; count: number }[];
    dxCandidates: DxCandidate[];
  };
}

const openStatuses = ['todo', 'doing', 'pending'];

function toInboxItem(record: InboxRecord): DashboardInboxItem {
  return {
    id: record.id,
    receivedAt: record.receivedAt,
    source: record.source,
    roomName: record.roomName,
    senderName: record.senderName,
    summary: record.summary || record.subject || record.originalText.slice(0, 60),
    priority: record.priority,
    riskLevel: record.riskLevel,
    riskType: record.riskType,
    replyNeeded: record.replyNeeded,
    status: record.status
  };
}

function toTaskItem(record: TaskRecord): DashboardTaskItem {
  return {
    id: record.id,
    taskTitle: record.taskTitle,
    ownerType: record.ownerType,
    ownerName: record.ownerName,
    dueDate: record.dueDate,
    dueDateText: record.dueDateText,
    priority: record.priority,
    requiresPresident: record.requiresPresident,
    projectName: record.projectName,
    nextAction: record.nextAction
  };
}

function toDraftItem(record: ReplyDraftRecord): DashboardDraftItem {
  return {
    id: record.id,
    recipientName: record.recipientName,
    draftText: record.draftText.length > 120 ? `${record.draftText.slice(0, 120)}…` : record.draftText,
    confirmationNeeded: record.confirmationNeeded,
    createdAt: record.createdAt
  };
}

function byReceivedAtDesc(a: InboxRecord, b: InboxRecord): number {
  return b.receivedAt.localeCompare(a.receivedAt);
}

export async function buildDashboardSummary(
  repository: Repository,
  now = new Date()
): Promise<DashboardSummary> {
  const today = todayIsoDate(now);
  const inbox = await repository.getInboxRecordsByDateRange();
  const tasks = await repository.getTasksByDateRange();
  const replyDrafts = await repository.getReplyDraftsByDateRange();
  const digest = await generateProblemDigest(repository, { source: 'all', days: 30, now });

  const active = inbox.filter((item) => item.status !== 'archived');
  const unreviewed = active.filter((item) => item.status === 'unreviewed');
  const todayReceived = active.filter((item) => isSameDate(item.receivedAt, today));
  const presidentDecision = active.filter((item) => item.priority === 'A');
  const highRisk = active.filter((item) => item.riskLevel === 'high');
  const replyNeeded = active.filter((item) => item.replyNeeded);

  const openTasks = tasks.filter((task) => openStatuses.includes(task.status));
  const presidentTasks = openTasks.filter((task) => task.requiresPresident);
  const overdueTasks = openTasks.filter((task) => isBeforeDate(task.dueDate, today));
  const waitingDrafts = replyDrafts.filter((draft) => draft.approvalStatus === 'waiting');

  return {
    generatedAt: now.toISOString(),
    tiles: {
      unreviewed: unreviewed.length,
      todayReceived: todayReceived.length,
      presidentDecision: presidentDecision.length,
      replyDraftWaiting: waitingDrafts.length,
      openTasks: openTasks.length,
      overdue: overdueTasks.length,
      highRisk: highRisk.length
    },
    realtime: [...active].sort(byReceivedAtDesc).slice(0, 10).map(toInboxItem),
    decisions: {
      inbox: [...presidentDecision].sort(byReceivedAtDesc).slice(0, 10).map(toInboxItem),
      tasks: presidentTasks.slice(0, 10).map(toTaskItem),
      overdueTasks: overdueTasks.slice(0, 10).map(toTaskItem)
    },
    confirmations: {
      replyDrafts: waitingDrafts.slice(0, 10).map(toDraftItem),
      replyNeeded: [...replyNeeded].sort(byReceivedAtDesc).slice(0, 10).map(toInboxItem)
    },
    improvements: {
      from: digest.from,
      to: digest.to,
      problemCount: digest.problemCount,
      categories: digest.categories.map((category) => ({ label: category.label, count: category.count })),
      dxCandidates: digest.dxCandidates
    }
  };
}
