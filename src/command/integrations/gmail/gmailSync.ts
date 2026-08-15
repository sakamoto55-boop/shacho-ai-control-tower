/**
 * Gmailリアルタイム同期（構成訂正§1）。
 *
 * Pub/Sub Pullで届いた通知 → history.list差分 → messages.get(metadata) → 共通InboundPipeline。
 * - 冪等: messageId(externalId)+threadId+historyId+contentHash（RawEvent側で担保）
 * - stateファイル: historyId / watchExpiration / lastEventAt / lastSuccessfulFetchAt / 実測lag
 * - 取得失敗と新着なしを区別（FetchOutcome）。実着信確認まではLIVE_APIと報告しない。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GmailClient } from './gmailClient.js';
import { IntelligenceStore } from '../../intelligence/store.js';
import { processInboundEvent, type InboundResult } from '../../intelligence/inboundPipeline.js';

export interface GmailSyncState {
  historyId: string | null;
  watchExpiration: string | null; // ISO
  lastEventAt: string | null; // Pub/Sub通知の最終受信
  lastSuccessfulFetchAt: string | null;
  lastMeasuredLagMs: number | null; // メール内部日時→処理完了の実測遅延
  processedCount: number;
}

export function defaultGmailStateFile(): string {
  return process.env.GMAIL_STATE_FILE
    ?? join(process.env.LOCALAPPDATA ?? '.', 'LCC_COMMAND', 'data', 'intelligence', 'gmail-state.json');
}

export function loadGmailState(file = defaultGmailStateFile()): GmailSyncState {
  if (existsSync(file)) {
    try { return JSON.parse(readFileSync(file, 'utf8')) as GmailSyncState; } catch { /* fallthrough */ }
  }
  return { historyId: null, watchExpiration: null, lastEventAt: null, lastSuccessfulFetchAt: null, lastMeasuredLagMs: null, processedCount: 0 };
}

export function saveGmailState(state: GmailSyncState, file = defaultGmailStateFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

/** watchの毎日更新（expirationが24h以内なら再watch）。呼出は起動時+日次 */
export async function ensureWatch(client: GmailClient, state: GmailSyncState): Promise<GmailSyncState> {
  const exp = state.watchExpiration ? Date.parse(state.watchExpiration) : 0;
  if (exp - Date.now() > 24 * 3600_000) return state;
  const w = await client.watch();
  return {
    ...state,
    historyId: state.historyId ?? w.historyId,
    watchExpiration: new Date(Number(w.expiration)).toISOString()
  };
}

export interface GmailProcessResult {
  outcome: 'NEW_EVENTS' | 'NO_NEW_EVENTS' | 'FETCH_FAILED';
  processed: InboundResult[];
  error?: string;
  state: GmailSyncState;
}

/** Pub/Sub通知1件（{emailAddress,historyId}）を処理する。RawEvent永続化成功が戻り条件（ACK可否の判定材料） */
export async function processGmailNotification(
  client: GmailClient,
  store: IntelligenceStore,
  state: GmailSyncState,
  notification: { historyId?: string | number },
  stateFile = defaultGmailStateFile()
): Promise<GmailProcessResult> {
  const eventAt = new Date().toISOString();
  const next: GmailSyncState = { ...state, lastEventAt: eventAt };
  const startId = state.historyId ?? String(notification.historyId ?? '');
  if (!startId) {
    // 初回はhistory基点のみ保存（次回から差分取得）
    next.historyId = String(notification.historyId ?? '');
    saveGmailState(next, stateFile);
    return { outcome: 'NO_NEW_EVENTS', processed: [], state: next };
  }
  try {
    const { newMessageIds, latestHistoryId } = await client.listHistory(startId);
    const processed: InboundResult[] = [];
    for (const id of newMessageIds) {
      const meta = await client.getMessageMeta(id);
      const text = `${meta.subject}\n${meta.snippet}`.trim();
      const r = processInboundEvent(store, {
        companyId: 'lcc',
        source: 'gmail',
        externalId: meta.messageId,
        content: { ...meta },
        text,
        fromLabel: meta.from.slice(0, 60),
        watchKey: `gmail:${meta.threadId}`,
        asOf: meta.date
      });
      processed.push(r);
      if (meta.date) next.lastMeasuredLagMs = Date.now() - Date.parse(meta.date);
    }
    next.historyId = latestHistoryId ?? String(notification.historyId ?? startId);
    next.lastSuccessfulFetchAt = new Date().toISOString();
    next.processedCount = state.processedCount + processed.filter((p) => p.outcome !== 'DEDUPLICATED').length;
    saveGmailState(next, stateFile);
    return { outcome: processed.length > 0 ? 'NEW_EVENTS' : 'NO_NEW_EVENTS', processed, state: next };
  } catch (e) {
    saveGmailState(next, stateFile); // lastEventAtのみ更新（失敗を成功と偽らない）
    return { outcome: 'FETCH_FAILED', processed: [], error: e instanceof Error ? e.message : String(e), state: next };
  }
}
