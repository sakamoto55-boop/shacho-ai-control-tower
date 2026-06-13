import type { DailyReport, InboxRecord, ReplyDraftRecord, TaskRecord } from '../domain/types.js';
import type { Repository } from '../repositories/Repository.js';
import { isBeforeDate, isSameDate, todayIsoDate } from '../utils/date.js';

export type ReportKind = 'morning' | 'noon' | 'evening';

function pickTopInbox(inbox: InboxRecord[], limit = 3): InboxRecord[] {
  const score = (item: InboxRecord): number => {
    let value = 0;
    if (item.priority === 'A') value += 100;
    if (item.riskLevel === 'high') value += 80;
    if (item.replyNeeded) value += 30;
    if (item.status === 'unreviewed') value += 20;
    return value;
  };
  return [...inbox].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

function pickTopTasks(tasks: TaskRecord[], limit = 3): TaskRecord[] {
  const score = (item: TaskRecord): number => {
    let value = 0;
    if (item.priority === 'A') value += 100;
    if (item.requiresPresident) value += 60;
    if (isBeforeDate(item.dueDate)) value += 50;
    if (isSameDate(item.dueDate)) value += 30;
    return value;
  };
  return [...tasks].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

function lineOrNone<T>(items: T[], formatter: (item: T, index: number) => string): string {
  if (items.length === 0) return 'なし';
  return items.map(formatter).join('\n');
}

function buildHeader(kind: ReportKind): string {
  const label = kind === 'morning' ? '朝' : kind === 'noon' ? '昼' : '夜';
  return `【社長AI管制塔｜${label}】`;
}

function describeInbox(item: InboxRecord): string {
  const project = item.projectName || item.customerName || item.senderName || '案件未特定';
  const room = item.roomName ? `[${item.roomName}]` : '';
  const action = item.priority === 'A' ? '→社長確認' : item.replyNeeded ? '→返信確認' : '→担当振り分け';
  const risk = item.riskLevel === 'high' ? ' ⚠高リスク' : item.riskLevel === 'medium' ? ' △中リスク' : '';
  return `${room}${project} / ${item.summary}${risk} ${action}`;
}

function describeReplyDraft(item: ReplyDraftRecord, inbox: InboxRecord[]): string {
  const source = inbox.find((record) => record.id === item.sourceInboxId);
  const recipient = item.recipientName || source?.senderName || '相手未特定';
  const point = source?.summary ?? item.draftText.slice(0, 40);
  return `${recipient} / ${point}`;
}

export async function generateDailyReport(
  repository: Repository,
  kind: ReportKind,
  now = new Date()
): Promise<DailyReport> {
  const today = todayIsoDate(now);
  const inbox = await repository.getInboxRecordsByDateRange();
  const tasks = await repository.getTasksByDateRange();
  const replyDrafts = await repository.getReplyDraftsByDateRange();

  const openTasks = tasks.filter((task) => ['todo', 'doing', 'pending'].includes(task.status));
  const waitingDrafts = replyDrafts.filter((draft) => draft.approvalStatus === 'waiting');
  const risks = inbox.filter((item) => item.riskLevel === 'high' || item.riskLevel === 'medium');
  const presidentDecision = inbox.filter((item) => item.priority === 'A');
  const importantUnreplied = inbox.filter(
    (item) => item.replyNeeded && item.status !== 'archived' && item.status !== 'reviewed'
  );
  const dueToday = openTasks.filter((task) => isSameDate(task.dueDate, today));
  const overdue = openTasks.filter((task) => isBeforeDate(task.dueDate, today));
  const delegateTasks = openTasks.filter((task) => !task.requiresPresident);

  const counts = {
    importantUnreplied: importantUnreplied.length,
    presidentDecision: presidentDecision.length,
    delegateTasks: delegateTasks.length,
    dueToday: dueToday.length,
    risks: risks.length,
    replyDrafts: waitingDrafts.length,
    overdue: overdue.length
  };

  const topInbox = pickTopInbox(kind === 'noon' ? inbox.filter((item) => item.priority !== 'C') : inbox, 3);
  const topTasks = pickTopTasks(openTasks, 3);
  const topDrafts = waitingDrafts.slice(0, 3);

  const purposeLine =
    kind === 'morning'
      ? '今日の社長判断・未返信・期限を確認してください。'
      : kind === 'noon'
        ? '午前中の割り込みと午後に止まりそうな案件を確認してください。'
        : '本日の未完了と明日の最重要事項を確認してください。';

  const text = [
    buildHeader(kind),
    purposeLine,
    '',
    '--- 件数サマリー ---',
    `重要未返信    : ${counts.importantUnreplied}件`,
    `社長判断必要  : ${counts.presidentDecision}件`,
    `担当振り分け  : ${counts.delegateTasks}件`,
    `今日中の期限  : ${counts.dueToday}件`,
    `リスク検知    : ${counts.risks}件`,
    `返信下書き待ち: ${counts.replyDrafts}件`,
    `期限超過      : ${counts.overdue}件`,
    '',
    '--- 最優先案件 ---',
    lineOrNone(topInbox, (item, index) => `${index + 1}. ${describeInbox(item)}`),
    '',
    '--- 確認待ち返信下書き ---',
    lineOrNone(topDrafts, (item, index) => `${index + 1}. ${describeReplyDraft(item, inbox)}`),
    '',
    '--- 期限・滞留タスク ---',
    lineOrNone(topTasks, (item, index) => {
      const owner = item.ownerName ? `${item.ownerType}:${item.ownerName}` : item.ownerType;
      const pres = item.requiresPresident ? ' [社長判断]' : '';
      return `${index + 1}. ${item.taskTitle} / ${owner} / ${item.dueDateText}${pres}`;
    }),
    ''
  ].join('\n');


  return {
    kind,
    generatedAt: now.toISOString(),
    text,
    counts
  };
}
