import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildAlertSummary, formatEmailAlert } from '../alerts/emailAlertFormatter.js';
import { isGmailConfigured, RealGmailConnector } from '../connectors/gmailClient.js';
import { createGmailConnector } from '../connectors/gmail.js';
import { createLineworksConnector } from '../connectors/lineworks.js';
import { sendGmailNotification } from '../notifiers/gmailNotifier.js';
import { sendSlackNotification } from '../notifiers/slackNotifier.js';
import type { NotificationResult } from '../notifiers/NotificationResult.js';
import type { StoredMessageBundle } from '../domain/types.js';
import type { Repository } from '../repositories/Repository.js';
import { analyzeAndSaveMessage } from './analyzeIncomingMessages.js';

export type AlertSlot = 'morning' | 'noon' | 'evening';

export interface EmailAlertResult {
  slot: AlertSlot;
  slotLabel: string;
  processedCount: number;
  newCount: number;
  outstandingCount: number;
  priorityACounts: number;
  riskCount: number;
  errors: string[];
  alertText: string;
  savedPath?: string;
  notifications: NotificationResult[];
}

const SLOT_LABEL: Record<AlertSlot, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕'
};

async function saveAlertToFile(text: string, slot: AlertSlot, now: Date): Promise<string> {
  const basePath = process.env.ALERT_SAVE_PATH ?? './data/alerts';
  const filename = `alert-${now.toISOString().slice(0, 10)}-${slot}.txt`;
  const fullPath = resolve(basePath, filename);
  await mkdir(basePath, { recursive: true });
  await writeFile(fullPath, text, 'utf8');
  return fullPath;
}

function deduplicateByExternalId<T extends { externalMessageId?: string }>(
  ...lists: T[][]
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = item.externalMessageId ?? `__no_id_${Math.random()}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
  }
  return result;
}

export async function runEmailAlertJob(
  repository: Repository,
  slot: AlertSlot,
  now = new Date()
): Promise<EmailAlertResult> {
  const errors: string[] = [];

  // 1. Gmail から新着メールを取得・分析・保存
  const connector = isGmailConfigured() ? new RealGmailConnector() : createGmailConnector();
  const [unread, unreplied] = await Promise.allSettled([
    connector.fetchUnreadEmails(),
    connector.fetchUnrepliedEmails()
  ]);

  const unreadList = unread.status === 'fulfilled' ? unread.value : [];
  const unrepliedList = unreplied.status === 'fulfilled' ? unreplied.value : [];
  if (unread.status === 'rejected') errors.push(`未読取得エラー: ${String(unread.reason)}`);
  if (unreplied.status === 'rejected') errors.push(`未返信取得エラー: ${String(unreplied.reason)}`);

  const messages = deduplicateByExternalId(unreadList, unrepliedList);
  const freshBundles: StoredMessageBundle[] = [];
  let newCount = 0;

  for (const msg of messages) {
    try {
      const bundle = await analyzeAndSaveMessage(repository, msg);
      freshBundles.push(bundle);
      const isNew = Date.now() - new Date(bundle.inbox.createdAt).getTime() < 60_000;
      if (isNew) newCount += 1;
    } catch (err) {
      errors.push(`分析エラー [${msg.subject ?? 'no subject'}]: ${String(err)}`);
    }
  }

  // 2. リポジトリから未処理の既存メールを取得してバンドルを再構成
  // unreviewed / task_created / draft_created はすべて「未対応」として扱う
  const PENDING_STATUSES = new Set(['unreviewed', 'task_created', 'draft_created']);
  const [allInbox, openTasks, waitingDrafts] = await Promise.all([
    repository.getInboxRecordsByDateRange(),
    repository.getOpenTasks(),
    repository.getWaitingReplyDrafts()
  ]);
  const unreviewedInbox = allInbox.filter((r) => PENDING_STATUSES.has(r.status));

  const freshInboxIds = new Set(freshBundles.map((b) => b.inbox.id));
  const outstandingBundles: StoredMessageBundle[] = unreviewedInbox
    .filter((inbox) => !freshInboxIds.has(inbox.id))
    .map((inbox) => ({
      inbox,
      tasks: openTasks.filter((t) => t.sourceInboxId === inbox.id),
      replyDraft: waitingDrafts.find((d) => d.sourceInboxId === inbox.id)
    }));

  const allBundles = [...freshBundles, ...outstandingBundles];
  const newInboxIds = new Set(freshBundles.map((b) => b.inbox.id));

  const alertText = formatEmailAlert(allBundles, slot, now, newInboxIds);
  const summary = buildAlertSummary(allBundles);

  let savedPath: string | undefined;
  try {
    savedPath = await saveAlertToFile(alertText, slot, now);
  } catch (err) {
    errors.push(`保存エラー: ${String(err)}`);
  }

  const notifications: NotificationResult[] = [];
  const shouldNotify = summary.priorityA > 0 || summary.risks > 0 || allBundles.length > 0;

  if (shouldNotify) {
    const slotLabel = SLOT_LABEL[slot];
    const subject = `【社長AI管制塔｜${slotLabel}】要対応${allBundles.length}件 / A優先${summary.priorityA}件`;

    // Gmail自分宛メール
    notifications.push(await sendGmailNotification(subject, alertText));

    // Slack（SLACK_WEBHOOK_URL が設定されている場合）
    notifications.push(await sendSlackNotification(alertText, summary));

    // LINE WORKS（認証情報 + LINEWORKS_DRY_RUN=false のとき実送信）
    try {
      const lwText = `${subject}\n\n${alertText}`;
      const lw = await createLineworksConnector().sendNotification(lwText);
      notifications.push({ channel: 'lineworks', sent: !lw.dryRun, dryRun: lw.dryRun });
    } catch (err) {
      notifications.push({ channel: 'lineworks', sent: false, dryRun: false, error: String(err) });
    }
  }

  const sentChannels = notifications.filter((n) => n.sent).map((n) => n.channel);
  console.log(
    `[EmailAlert] ${SLOT_LABEL[slot]}の部 完了: 新着${newCount}件 + 未処理継続${outstandingBundles.length}件, A優先${summary.priorityA}件` +
      (sentChannels.length ? ` → 通知: ${sentChannels.join(', ')}` : ' → 通知: なし（未設定）')
  );

  return {
    slot,
    slotLabel: SLOT_LABEL[slot],
    processedCount: allBundles.length,
    newCount,
    outstandingCount: outstandingBundles.length,
    priorityACounts: summary.priorityA,
    riskCount: summary.risks,
    errors,
    alertText,
    savedPath,
    notifications
  };
}
