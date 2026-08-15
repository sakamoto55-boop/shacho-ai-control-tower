/**
 * LINE WORKS耐久outboxのdrain（後続処理）。
 *
 * relayはPub/Sub publish失敗時（内部再試行後）にイベントをGCS outboxへ保存する。
 * LINE WORKSはCallback失敗時に再送しないため、このdrainが「必ず取り込む」後続経路となる。
 * - 取込はInboundPipeline経由（RawEvent冪等: publish経路と重複しても二重タスク化しない）
 * - 取込成功したオブジェクトのみ削除（失敗分は残す→次回drainで再処理）
 */
import { IntelligenceStore } from '../../intelligence/store.js';
import { processInboundEvent, type InboundResult } from '../../intelligence/inboundPipeline.js';
import type { GoogleSaTokenSource } from '../common/googleSaAuth.js';

const STORAGE_BASE = 'https://storage.googleapis.com/storage/v1';
export const OUTBOX_PREFIX = 'lineworks-outbox/';

export interface OutboxDrainResult {
  outcome: 'DRAINED' | 'NO_ITEMS' | 'FETCH_FAILED';
  processed: number;
  deduplicated: number;
  failed: number;
  error?: string;
}

export interface OutboxObject {
  attributes: Record<string, string>;
  data: string; // relayが受理したLINE WORKS原文（rawBody）
}

/** outboxオブジェクト1件をInboundPipelineへ流す（relay publish経路と同じ写像） */
export function processOutboxObject(store: IntelligenceStore, obj: OutboxObject): InboundResult {
  const payload = JSON.parse(obj.data || '{}') as Record<string, Record<string, unknown>>;
  const roomId = String(payload.source?.roomId ?? payload.source?.channelId ?? payload.source?.userId ?? 'unknown');
  const text = String((payload.content as Record<string, unknown> | undefined)?.text ?? '');
  return processInboundEvent(store, {
    companyId: 'lcc',
    source: 'lineworks',
    externalId: obj.attributes.eventKey || obj.attributes.contentHash,
    content: payload as Record<string, unknown>,
    text,
    fromLabel: String(payload.source?.userId ?? 'lineworks'),
    watchKey: `lineworks:${roomId}`,
    asOf: obj.attributes.receivedAt ?? null
  });
}

export async function drainLineworksOutbox(
  tokenSource: GoogleSaTokenSource,
  bucket: string,
  store: IntelligenceStore,
  fetchImpl: typeof fetch = fetch,
  maxObjects = 50
): Promise<OutboxDrainResult> {
  let token: string;
  try { token = await tokenSource.getToken(); }
  catch (e) { return { outcome: 'FETCH_FAILED', processed: 0, deduplicated: 0, failed: 0, error: e instanceof Error ? e.message : String(e) }; }
  const auth = { authorization: `Bearer ${token}` };

  let items: Array<{ name: string }>;
  try {
    const res = await fetchImpl(`${STORAGE_BASE}/b/${bucket}/o?prefix=${encodeURIComponent(OUTBOX_PREFIX)}&maxResults=${maxObjects}`, { headers: auth });
    if (!res.ok) return { outcome: 'FETCH_FAILED', processed: 0, deduplicated: 0, failed: 0, error: `list HTTP ${res.status}` };
    items = ((await res.json()) as { items?: Array<{ name: string }> }).items ?? [];
  } catch (e) {
    return { outcome: 'FETCH_FAILED', processed: 0, deduplicated: 0, failed: 0, error: e instanceof Error ? e.message : String(e) };
  }
  if (items.length === 0) return { outcome: 'NO_ITEMS', processed: 0, deduplicated: 0, failed: 0 };

  let processed = 0, deduplicated = 0, failed = 0;
  for (const it of items) {
    try {
      const res = await fetchImpl(`${STORAGE_BASE}/b/${bucket}/o/${encodeURIComponent(it.name)}?alt=media`, { headers: auth });
      if (!res.ok) throw new Error(`get HTTP ${res.status}`);
      const obj = (await res.json()) as OutboxObject;
      const r = processOutboxObject(store, obj);
      if (r.outcome !== 'DEDUPLICATED') processed += 1; else deduplicated += 1; // RECOVERED（派生再開）も取込成功
      // 永続化成功後のみ削除（失敗分は残して次回再処理）
      const del = await fetchImpl(`${STORAGE_BASE}/b/${bucket}/o/${encodeURIComponent(it.name)}`, { method: 'DELETE', headers: auth });
      if (!del.ok && del.status !== 404) throw new Error(`delete HTTP ${del.status}`);
    } catch {
      failed += 1; // 残置→次回drainで再処理（イベントを失わない）
    }
  }
  return { outcome: 'DRAINED', processed, deduplicated, failed };
}
