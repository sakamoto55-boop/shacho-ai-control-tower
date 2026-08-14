import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
// @ts-expect-error mjs（Cloud Run relay純関数コア。依存ゼロを維持するためmjsのまま検査）
import { decideRelay, createSeenCache } from '../../../cloudrun/lcc-lineworks-relay/relayCore.mjs';

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

  it('seenキャッシュは同一キーの2回目からtrue', () => {
    const c = createSeenCache(10);
    expect(c.check('k1')).toBe(false);
    expect(c.check('k1')).toBe(true);
  });
});
