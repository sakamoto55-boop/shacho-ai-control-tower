import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGmailAuthState } from '../../../src/command/integrations/gmail/gmailClient.js';
import { loadGmailState, processGmailNotification, saveGmailState } from '../../../src/command/integrations/gmail/gmailSync.js';
import { PubsubPullSubscriber } from '../../../src/command/integrations/common/pubsubPull.js';
import { GoogleSaTokenSource } from '../../../src/command/integrations/common/googleSaAuth.js';
import { IntelligenceStore } from '../../../src/command/intelligence/store.js';
import type { GmailClient } from '../../../src/command/integrations/gmail/gmailClient.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'lcc-rt-'));

// Gmail fixtureクライアント（emulator相当・安全なテストデータ）
const fakeGmail = (messages: Record<string, { threadId: string; subject: string; snippet: string; from: string; date: string }>): GmailClient =>
  ({
    listHistory: async () => ({ newMessageIds: Object.keys(messages), latestHistoryId: '2000' }),
    getMessageMeta: async (id: string) => ({
      messageId: id, threadId: messages[id].threadId, historyId: '2000',
      from: messages[id].from, to: 'sakamoto55@lcc55.com', subject: messages[id].subject,
      date: messages[id].date, snippet: messages[id].snippet, attachments: []
    })
  }) as unknown as GmailClient;

describe('Gmail Pull同期（構成訂正§1・fixture E2E）', () => {
  it('CONFIG_REQUIRED判定: OAuth/topic未設定を正直に返す', () => {
    const saved = { id: process.env.GMAIL_CLIENT_ID, sec: process.env.GMAIL_CLIENT_SECRET, top: process.env.GMAIL_PUBSUB_TOPIC };
    delete process.env.GMAIL_CLIENT_ID; delete process.env.GMAIL_CLIENT_SECRET; delete process.env.GMAIL_PUBSUB_TOPIC;
    const s = resolveGmailAuthState();
    expect(s.state).toBe('CONFIG_REQUIRED');
    if (s.state === 'CONFIG_REQUIRED') expect(s.reason).toContain('GMAIL_CLIENT_ID');
    if (saved.id) process.env.GMAIL_CLIENT_ID = saved.id;
    if (saved.sec) process.env.GMAIL_CLIENT_SECRET = saved.sec;
    if (saved.top) process.env.GMAIL_PUBSUB_TOPIC = saved.top;
  });

  it('通知→history差分→InboundPipeline→DecisionCase生成、lag実測とstate更新（§12-1 fixture版）', async () => {
    const dir = tmp();
    const stateFile = join(dir, 'gmail-state.json');
    saveGmailState({ historyId: '1000', watchExpiration: null, lastEventAt: null, lastSuccessfulFetchAt: null, lastMeasuredLagMs: null, processedCount: 0 }, stateFile);
    const store = new IntelligenceStore(join(dir, 'intel'));
    const client = fakeGmail({
      'msg-a': { threadId: 't1', subject: '【至急】山田様邸 追加工事の金額変更ご相談', snippet: '至急ご判断ください', from: '山田様 <y@example.com>', date: new Date(Date.now() - 5000).toISOString() }
    });
    const r = await processGmailNotification(client, store, loadGmailState(stateFile), { historyId: 1500 }, stateFile);
    expect(r.outcome).toBe('NEW_EVENTS');
    expect(r.processed[0].createdCase).not.toBeNull(); // DecisionCaseまで生成
    expect(r.state.historyId).toBe('2000');
    expect(r.state.lastSuccessfulFetchAt).not.toBeNull();
    expect(r.state.lastMeasuredLagMs).toBeGreaterThanOrEqual(0); // 実測遅延を記録
    // 同一通知の再配信でも重複タスクを作らない（§6-4）
    const r2 = await processGmailNotification(client, store, loadGmailState(stateFile), { historyId: 1500 }, stateFile);
    expect(r2.processed.every((p) => p.outcome === 'DEDUPLICATED')).toBe(true);
    expect(store.actions().filter((a) => a.status === 'WAITING_PRESIDENT')).toHaveLength(1);
  });

  it('E2E-2: 11ページ以上のhistoryをnextPageTokenがなくなるまで全件取得する（§E）', async () => {
    const { GmailClient } = await import('../../../src/command/integrations/gmail/gmailClient.js');
    const PAGES = 11;
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.includes('/history')) {
        const page = calls; calls += 1;
        return {
          ok: true,
          json: async () => ({
            history: [{ id: String(1000 + page), messagesAdded: [{ message: { id: `pmsg-${page}` } }] }],
            historyId: '9999',
            ...(page < PAGES - 1 ? { nextPageToken: `pt-${page + 1}` } : {})
          })
        };
      }
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;
    const client = new GmailClient(
      { clientId: 'id', clientSecret: 'sec', redirectUri: 'http://127.0.0.1:1/x', tokenFile: join(tmp(), 'no-token.json'), pubsubTopic: 'projects/p/topics/t' },
      fetchImpl
    );
    // token注入（refresh不要な未来expiry）
    (client as unknown as { tokens: unknown }).tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000, scope: 'gmail.readonly' };
    const r = await client.listHistory('1000');
    expect(calls).toBe(PAGES);
    expect(r.newMessageIds).toHaveLength(PAGES); // 10ページ制限で切り捨てない
    expect(r.latestHistoryId).toBe('9999');
    // 安全上限超過（未取得分が残る）はthrow＝historyIdを進めない材料
    calls = 0;
    await expect(client.listHistory('1000', 5)).rejects.toThrow(/安全上限/);
  });

  it('E2E-2b: 安全上限超過はFETCH_FAILEDになりhistoryIdが進まない（未処理範囲を失わない）', async () => {
    const dir = tmp();
    const stateFile = join(dir, 'gmail-state.json');
    saveGmailState({ historyId: '1000', watchExpiration: null, lastEventAt: null, lastSuccessfulFetchAt: null, lastMeasuredLagMs: null, processedCount: 0 }, stateFile);
    const overflowing = {
      listHistory: async () => { throw new Error('history取得が安全上限100ページを超過（未取得分があるためhistoryIdを進めない）'); }
    } as unknown as GmailClient;
    const r = await processGmailNotification(overflowing, new IntelligenceStore(join(dir, 'i3')), loadGmailState(stateFile), { historyId: 9999 }, stateFile);
    expect(r.outcome).toBe('FETCH_FAILED');
    expect(r.state.historyId).toBe('1000'); // 進めない＝次回に未取得分を再取得できる
    expect(r.state.lastSuccessfulFetchAt).toBeNull();
  });

  it('取得失敗はFETCH_FAILEDで成功と偽らない・stateのlastSuccessfulFetchAtを進めない', async () => {
    const dir = tmp();
    const stateFile = join(dir, 'gmail-state.json');
    saveGmailState({ historyId: '1000', watchExpiration: null, lastEventAt: null, lastSuccessfulFetchAt: null, lastMeasuredLagMs: null, processedCount: 0 }, stateFile);
    const failing = { listHistory: async () => { throw new Error('HTTP 500'); } } as unknown as GmailClient;
    const r = await processGmailNotification(failing, new IntelligenceStore(join(dir, 'i2')), loadGmailState(stateFile), { historyId: 1500 }, stateFile);
    expect(r.outcome).toBe('FETCH_FAILED');
    expect(r.state.lastSuccessfulFetchAt).toBeNull();
    expect(r.state.lastEventAt).not.toBeNull(); // 通知受信自体は記録
  });
});

describe('Pub/Sub Pull subscriber（ACK規律・dead-letter）', () => {
  const fakeTokenSource = { getToken: async () => 'sa-token' } as unknown as GoogleSaTokenSource;
  const pullResponse = (msgs: Array<{ ackId: string; id: string; data: unknown }>) => ({
    ok: true,
    json: async () => ({
      receivedMessages: msgs.map((m) => ({
        ackId: m.ackId,
        message: { messageId: m.id, publishTime: '2026-08-14T00:00:00Z', data: Buffer.from(JSON.stringify(m.data)).toString('base64') }
      }))
    })
  });

  it('処理成功のみACKし、失敗はACKせず再配信に任せる（永続化成功後ACK）', async () => {
    const acked: string[][] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith(':pull')) return pullResponse([
        { ackId: 'A1', id: 'm1', data: { ok: true } },
        { ackId: 'A2', id: 'm2', data: { ok: false } }
      ]);
      if (String(url).endsWith(':acknowledge')) {
        acked.push((JSON.parse(String(init?.body)) as { ackIds: string[] }).ackIds);
        return { ok: true, json: async () => ({}) };
      }
      throw new Error('unexpected');
    }) as unknown as typeof fetch;
    const sub = new PubsubPullSubscriber(fakeTokenSource, 'projects/p/subscriptions/s', {
      deadLetterFile: join(tmp(), 'dead.jsonl'), fetchImpl
    });
    const r = await sub.pullOnce(async (msg) => {
      const d = JSON.parse(msg.data) as { ok: boolean };
      if (!d.ok) throw new Error('persist failed');
    });
    expect(r.outcome).toBe('NEW_EVENTS');
    expect(r.acked).toBe(1);
    expect(acked[0]).toEqual(['A1']); // 失敗したA2はACKしない
  });

  it('N回連続失敗はdead-letterへ隔離してACK（毒メッセージで詰まらせない・内容保全）', async () => {
    const dl = join(tmp(), 'dead.jsonl');
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(':pull')) return pullResponse([{ ackId: 'A1', id: 'poison', data: { bad: 1 } }]);
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const sub = new PubsubPullSubscriber(fakeTokenSource, 'projects/p/subscriptions/s', {
      deadLetterFile: dl, maxFailuresBeforeDeadLetter: 2, fetchImpl
    });
    const fail = async () => { throw new Error('always'); };
    const r1 = await sub.pullOnce(fail);
    expect(r1.deadLettered).toBe(0);
    const r2 = await sub.pullOnce(fail);
    expect(r2.deadLettered).toBe(1);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(dl, 'utf8')).toContain('poison');
  });

  it('新着なしと取得失敗を区別する', async () => {
    const emptyFetch = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    const sub = new PubsubPullSubscriber(fakeTokenSource, 'projects/p/subscriptions/s', { deadLetterFile: join(tmp(), 'd.jsonl'), fetchImpl: emptyFetch });
    expect((await sub.pullOnce(async () => {})).outcome).toBe('NO_NEW_EVENTS');
    const errFetch = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    const sub2 = new PubsubPullSubscriber(fakeTokenSource, 'projects/p/subscriptions/s', { deadLetterFile: join(tmp(), 'd2.jsonl'), fetchImpl: errFetch });
    expect((await sub2.pullOnce(async () => {})).outcome).toBe('FETCH_FAILED');
  });
});
