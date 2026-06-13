import type { InboxRecord, ReplyDraftRecord, StoredMessageBundle, TaskRecord } from '../domain/types.js';
import type { AlertSlot } from '../jobs/emailAlertJob.js';

const SLOT_LABEL: Record<AlertSlot, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕'
};

const NEXT_SLOT: Record<AlertSlot, string> = {
  morning: '12:30',
  noon: '18:00',
  evening: '翌08:00'
};

const PRIORITY_ICON: Record<string, string> = {
  A: '🔴',
  B: '🟡',
  C: '⚪'
};

const RISK_LABEL: Record<string, string> = {
  complaint: 'クレーム',
  accident: '事故',
  site_stop: '現場停止',
  payment_delay: '入金遅延',
  manpower_shortage: '人員不足',
  gross_profit: '粗利・値引',
  contract: '契約・条件',
  labor: '労務',
  lost_order: '失注',
  none: ''
};

function formatReceivedAge(receivedAt: string): string {
  const diffMs = Date.now() - new Date(receivedAt).getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffM = Math.floor((diffMs % 3_600_000) / 60_000);
  if (diffH >= 24) return `${Math.floor(diffH / 24)}日前`;
  if (diffH >= 1) return `${diffH}時間前`;
  return `${diffM}分前`;
}

function formatJstDateTime(isoStr: string): string {
  return new Date(isoStr).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTasks(tasks: TaskRecord[]): string {
  if (tasks.length === 0) return '  タスクなし';
  return tasks
    .slice(0, 3)
    .map((t, i) => `  ${i + 1}. ${t.taskTitle}（${t.dueDateText} / ${t.ownerType}${t.ownerName ? `:${t.ownerName}` : ''}）`)
    .join('\n');
}

function formatReplyDraft(draft: ReplyDraftRecord | undefined): string {
  if (!draft) return '  返信下書きなし';
  const preview = draft.draftText.slice(0, 80).replace(/\n/g, ' ');
  const ellipsis = draft.draftText.length > 80 ? '…' : '';
  const warning = draft.confirmationNeeded.length > 0 ? ' ⚠要確認' : '';
  return `  ${preview}${ellipsis}${warning}`;
}

function formatBundle(bundle: StoredMessageBundle, index: number): string {
  const { inbox, tasks, replyDraft } = bundle;
  const icon = PRIORITY_ICON[inbox.priority] ?? '⚪';
  const age = formatReceivedAge(inbox.receivedAt);
  const jst = formatJstDateTime(inbox.receivedAt);
  const riskText =
    inbox.riskType !== 'none'
      ? `\n  リスク: ${RISK_LABEL[inbox.riskType] ?? inbox.riskType} (${inbox.riskLevel.toUpperCase()})`
      : '';
  const sender =
    inbox.senderName
      ? `${inbox.senderName}${inbox.senderAddress ? ` <${inbox.senderAddress}>` : ''}`
      : inbox.senderAddress || '差出人不明';

  return [
    `${icon} [${inbox.priority}] #${index + 1}  ${age}（${jst}）`,
    `  件名: ${inbox.subject || '（件名なし）'}`,
    `  差出人: ${sender}`,
    `  要約: ${inbox.summary}`,
    riskText,
    `  タスク:`,
    formatTasks(tasks),
    `  返信案:`,
    formatReplyDraft(replyDraft),
    '  ' + '─'.repeat(40)
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export interface EmailAlertSummary {
  total: number;
  priorityA: number;
  priorityB: number;
  risks: number;
  replyNeeded: number;
}

export function buildAlertSummary(bundles: StoredMessageBundle[]): EmailAlertSummary {
  return {
    total: bundles.length,
    priorityA: bundles.filter((b) => b.inbox.priority === 'A').length,
    priorityB: bundles.filter((b) => b.inbox.priority === 'B').length,
    risks: bundles.filter((b) => b.inbox.riskType !== 'none').length,
    replyNeeded: bundles.filter((b) => b.inbox.replyNeeded).length
  };
}

export function formatEmailAlert(
  bundles: StoredMessageBundle[],
  slot: AlertSlot,
  now = new Date()
): string {
  const label = SLOT_LABEL[slot];
  const jstNow = now.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const header = `【メールアラート｜${label}の部】${jstNow}`;
  const divider = '━'.repeat(40);

  if (bundles.length === 0) {
    return [
      header,
      divider,
      '要対応メールはありません。',
      divider,
      `次回アラート: ${NEXT_SLOT[slot]}`
    ].join('\n');
  }

  const summary = buildAlertSummary(bundles);
  const summaryLine = [
    `要対応: ${summary.total}件`,
    `優先度A: ${summary.priorityA}件`,
    `リスク検知: ${summary.risks}件`,
    `返信必要: ${summary.replyNeeded}件`
  ].join(' ｜ ');

  const sortedBundles = [...bundles].sort((a, b) => {
    const score = (bnd: StoredMessageBundle) => {
      let v = 0;
      if (bnd.inbox.priority === 'A') v += 100;
      if (bnd.inbox.riskLevel === 'high') v += 80;
      if (bnd.inbox.priority === 'B') v += 40;
      if (bnd.inbox.replyNeeded) v += 20;
      return v;
    };
    return score(b) - score(a);
  });

  const items = sortedBundles.map((b, i) => formatBundle(b, i)).join('\n\n');

  return [
    header,
    divider,
    summaryLine,
    divider,
    '',
    items,
    '',
    divider,
    `詳細確認: GET /dev/inbox`,
    `次回アラート: ${NEXT_SLOT[slot]}`,
    divider
  ].join('\n');
}
