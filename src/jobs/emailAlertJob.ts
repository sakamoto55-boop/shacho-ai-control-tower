import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildAlertSummary, formatEmailAlert } from '../alerts/emailAlertFormatter.js';
import { isGmailConfigured, RealGmailConnector } from '../connectors/gmailClient.js';
import { createGmailConnector } from '../connectors/gmail.js';
import { createLineworksConnector } from '../connectors/lineworks.js';
import type { StoredMessageBundle } from '../domain/types.js';
import type { Repository } from '../repositories/Repository.js';
import { analyzeAndSaveMessage } from './analyzeIncomingMessages.js';

export type AlertSlot = 'morning' | 'noon' | 'evening';

export interface EmailAlertResult {
  slot: AlertSlot;
  slotLabel: string;
  processedCount: number;
  newCount: number;
  priorityACounts: number;
  riskCount: number;
  errors: string[];
  alertText: string;
  savedPath?: string;
  sentToLineworks: boolean;
}

const SLOT_LABEL: Record<AlertSlot, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕'
};

async function saveAlertToFile(text: string, slot: AlertSlot, now: Date): Promise<string> {
  const basePath = process.env.ALERT_SAVE_PATH ?? './data/alerts';
  const dateStr = now
    .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    .replace(/[/\s:]/g, '-')
    .replace(/-+$/, '');
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

  const bundles: StoredMessageBundle[] = [];
  let newCount = 0;

  for (const msg of messages) {
    try {
      const bundle = await analyzeAndSaveMessage(repository, msg);
      bundles.push(bundle);
      // If repository returned the same record (duplicate), inbox.createdAt will be old
      const isNew = Date.now() - new Date(bundle.inbox.createdAt).getTime() < 60_000;
      if (isNew) newCount += 1;
    } catch (err) {
      errors.push(`分析エラー [${msg.subject ?? 'no subject'}]: ${String(err)}`);
    }
  }

  const alertText = formatEmailAlert(bundles, slot, now);
  const summary = buildAlertSummary(bundles);

  let savedPath: string | undefined;
  try {
    savedPath = await saveAlertToFile(alertText, slot, now);
  } catch (err) {
    errors.push(`保存エラー: ${String(err)}`);
  }

  let sentToLineworks = false;
  if (summary.priorityA > 0 || summary.risks > 0) {
    try {
      await createLineworksConnector().sendNotification(alertText);
      sentToLineworks = true;
    } catch (err) {
      errors.push(`LINE WORKS送信エラー: ${String(err)}`);
    }
  }

  console.log(`[EmailAlert] ${SLOT_LABEL[slot]}の部 完了: ${bundles.length}件処理, A優先${summary.priorityA}件, リスク${summary.risks}件`);

  return {
    slot,
    slotLabel: SLOT_LABEL[slot],
    processedCount: bundles.length,
    newCount,
    priorityACounts: summary.priorityA,
    riskCount: summary.risks,
    errors,
    alertText,
    savedPath,
    sentToLineworks
  };
}
