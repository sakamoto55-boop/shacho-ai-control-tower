import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntelligenceStore } from '../../../src/command/intelligence/store.js';
import { drainLineworksOutbox } from '../../../src/command/integrations/lineworks/outboxDrain.js';
import type { GoogleSaTokenSource } from '../../../src/command/integrations/common/googleSaAuth.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'lcc-drain-'));
const tokenSource = { getToken: async () => 't' } as unknown as GoogleSaTokenSource;

const outboxObj = (eventId: string, text: string) => ({
  attributes: { eventKey: eventId, contentHash: `h-${eventId}`, receivedAt: '2026-08-15T00:00:00Z', botId: 'bot-1' },
  data: JSON.stringify({ eventId, source: { roomId: 'room-1', userId: 'user-a' }, content: { text } })
});

describe('LINE WORKS outbox drain（後続処理で必ず取り込む・§3）', () => {
  it('outboxオブジェクトを取込み、永続化成功後にのみ削除する', async () => {
    const deleted: string[] = [];
    const objects = new Map([['lineworks-outbox/1-a.json', outboxObj('ev-a', '至急ご判断ください。金額変更の相談')]]);
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'DELETE') { deleted.push(u); objects.clear(); return { ok: true, json: async () => ({}) }; }
      if (u.includes('/o?prefix=')) return { ok: true, json: async () => ({ items: [...objects.keys()].map((name) => ({ name })) }) };
      if (u.includes('alt=media')) return { ok: true, json: async () => [...objects.values()][0] };
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;
    const store = new IntelligenceStore(tmp());
    const r = await drainLineworksOutbox(tokenSource, 'b', store, fetchImpl);
    expect(r.outcome).toBe('DRAINED');
    expect(r.processed).toBe(1);
    expect(deleted).toHaveLength(1); // 取込成功後に削除
    expect(store.rawEvents()).toHaveLength(1);
    expect(store.actions().some((a) => a.status === 'WAITING_PRESIDENT')).toBe(true); // 分類まで到達
  });

  it('取得失敗はFETCH_FAILED・削除失敗分は残置して次回再処理（イベントを失わない）', async () => {
    const store = new IntelligenceStore(tmp());
    const errFetch = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    expect((await drainLineworksOutbox(tokenSource, 'b', store, errFetch)).outcome).toBe('FETCH_FAILED');

    // 削除だけ失敗するケース: failedにカウントされ、オブジェクトは残る（後で再処理される）
    const fetchImpl2 = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'DELETE') return { ok: false, status: 500 };
      if (u.includes('/o?prefix=')) return { ok: true, json: async () => ({ items: [{ name: 'lineworks-outbox/2-b.json' }] }) };
      if (u.includes('alt=media')) return { ok: true, json: async () => outboxObj('ev-b', '見積の作成をお願いします') };
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;
    const r2 = await drainLineworksOutbox(tokenSource, 'b', store, fetchImpl2);
    expect(r2.failed).toBe(1);
    // 次回drain（削除が直った後）: RawEvent冪等により二重タスク化しない
    const fetchImpl3 = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'DELETE') return { ok: true, json: async () => ({}) };
      if (u.includes('/o?prefix=')) return { ok: true, json: async () => ({ items: [{ name: 'lineworks-outbox/2-b.json' }] }) };
      if (u.includes('alt=media')) return { ok: true, json: async () => outboxObj('ev-b', '見積の作成をお願いします') };
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;
    const r3 = await drainLineworksOutbox(tokenSource, 'b', store, fetchImpl3);
    expect(r3.deduplicated).toBe(1);
    expect(store.rawEvents().filter((e) => e.externalId === 'ev-b')).toHaveLength(1);
  });
});
