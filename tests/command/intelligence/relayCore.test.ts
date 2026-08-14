import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error mjs（Cloud Run relay純関数コア。依存ゼロを維持するためmjsのまま検査）
import { decideRelay, createSeenCache } from '../../../cloudrun/lcc-lineworks-relay/relayCore.mjs';
// @ts-expect-error mjs（耐久確保コア）
import { captureDurably } from '../../../cloudrun/lcc-lineworks-relay/durableCapture.mjs';
import { IntelligenceStore } from '../../../src/command/intelligence/store.js';
import { processOutboxObject } from '../../../src/command/integrations/lineworks/outboxDrain.js';

const SECRET = 'test-bot-secret';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('base64');
const NOW = Date.now();
const body = JSON.stringify({ eventId: 'ev-1', issuedTime: new Date(NOW).toISOString(), content: { text: 'テスト' } });

const base = () => ({
  rawBody: body,
  botIdHeader: 'bot-1',
  signatureHeader: sign(body),
  botSecret: SECRET,
  allowedBotIds: ['bot-1'],
  seenRecently: () => false,
  nowMs: NOW
});

describe('lcc-lineworks-relay コア判定（§12-3受入試験のfixture版）', () => {
  it('正署名+許可Bot+新規イベントのみpublish対象（200）', () => {
    const d = decideRelay(base());
    expect(d.status).toBe(200);
    expect(d.publish).toBeDefined();
    expect(d.publish.attributes.botId).toBe('bot-1');
    expect(d.publish.attributes.eventKey).toBe('ev-1');
  });

  it('不正署名は401・未知Bot IDは403・invalid JSONは400・oversizedは413', () => {
    expect(decideRelay({ ...base(), signatureHeader: 'x'.repeat(44) }).status).toBe(401);
    expect(decideRelay({ ...base(), botIdHeader: 'evil' }).status).toBe(403);
    const bad = 'not-json';
    expect(decideRelay({ ...base(), rawBody: bad, signatureHeader: sign(bad) }).status).toBe(400);
    const big = 'a'.repeat(65 * 1024);
    expect(decideRelay({ ...base(), rawBody: big, signatureHeader: sign(big) }).status).toBe(413);
  });

  it('古いtimestampはリプレイとして401、重複eventはpublishせず200（再送を止める）', () => {
    const old = JSON.stringify({ eventId: 'ev-old', issuedTime: new Date(NOW - 10 * 60_000).toISOString() });
    expect(decideRelay({ ...base(), rawBody: old, signatureHeader: sign(old) }).status).toBe(401);
    const dup = decideRelay({ ...base(), seenRecently: () => true });
    expect(dup.status).toBe(200);
    expect(dup.publish).toBeUndefined();
    expect(dup.reason).toContain('duplicate');
  });

  it('seenキャッシュはhas=照会のみ・add後にtrue（照会で登録しない）', () => {
    const c = createSeenCache(10);
    expect(c.has('k1')).toBe(false);
    expect(c.has('k1')).toBe(false); // 照会は何度でも副作用なし
    c.add('k1');
    expect(c.has('k1')).toBe(true);
  });

  it('publish内部再試行: 一時障害は再試行で回復し、恒常障害はoutboxへ退避する（LINE WORKSは再送しない前提・§3）', async () => {
    // 2回失敗→3回目成功: PUBLISHED
    let calls = 0;
    const flaky = await captureDurably({
      publish: async () => { calls += 1; if (calls < 3) throw new Error('503'); },
      sleep: async () => {}
    });
    expect(flaky.outcome).toBe('PUBLISHED');
    expect(flaky.publishAttempts).toBe(3);
    // 全滅→outbox保存: OUTBOXED（イベントは耐久確保される）
    let outboxed = 0;
    const down = await captureDurably({
      publish: async () => { throw new Error('503'); },
      outbox: async () => { outboxed += 1; },
      sleep: async () => {}
    });
    expect(down.outcome).toBe('OUTBOXED');
    expect(outboxed).toBe(1);
    // publish・outbox両方失敗のみFAILED（500=監視対象）
    const dead = await captureDurably({
      publish: async () => { throw new Error('503'); },
      outbox: async () => { throw new Error('gcs 500'); },
      sleep: async () => {}
    });
    expect(dead.outcome).toBe('FAILED');
  });

  it('E2E: LINE WORKSリクエスト1回だけ→publish障害→内部復旧（outbox→drain）→最終的にRawEvent 1件（§3）', async () => {
    const cache = createSeenCache(10);
    const outboxStore: Array<{ attributes: Record<string, string>; data: string }> = [];
    // --- リクエストは1回だけ（LINE WORKSは再送しない） ---
    const d = decideRelay({ ...base(), seenRecently: (k: string) => cache.has(k) });
    expect(d.status).toBe(200);
    const captured = await captureDurably({
      publish: async () => { throw new Error('pubsub 503'); }, // publish恒常障害
      outbox: async () => { outboxStore.push({ attributes: d.publish.attributes, data: d.publish.data }); },
      sleep: async () => {}
    });
    expect(captured.outcome).toBe('OUTBOXED');
    cache.add(d.seenKey); // 耐久確保後に登録（server.mjsと同じ規律）
    // --- 後続処理（LCC側drain）が必ず取り込む ---
    const store = new IntelligenceStore(mkdtempSync(join(tmpdir(), 'lcc-outbox-')));
    const r = processOutboxObject(store, outboxStore[0]);
    expect(r.outcome).toBe('PROCESSED');
    expect(store.rawEvents()).toHaveLength(1); // 最終的にRawEvent 1件（リクエストは1回のみ）
    // drainの冪等性: 同じoutboxオブジェクトを再処理しても重複しない
    expect(processOutboxObject(store, outboxStore[0]).outcome).toBe('DEDUPLICATED');
    expect(store.rawEvents()).toHaveLength(1);
  });
});
