import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { app } from '../../src/server.js';

/** CODEX是正4: 未認証ルートを閉じる（jobs認証必須・webhook署名検証） */
describe('未認証ルートの閉鎖（CODEX是正4）', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ['NODE_ENV', 'LCC_COMMAND_API_TOKENS', 'LINEWORKS_WEBHOOK_SECRET']) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it('/jobs/report/* はtokenなし401、正しいtokenで実行できる', async () => {
    process.env.LCC_COMMAND_API_TOKENS = JSON.stringify({ 'test-job-token': { role: 'PRESIDENT', companyIds: ['*'], label: 'test' } });
    for (const slot of ['morning', 'noon', 'evening']) {
      const res = await app.request(`/jobs/report/${slot}`, { method: 'POST' });
      expect(res.status, slot).toBe(401);
    }
    const ok = await app.request('/jobs/report/morning', { method: 'POST', headers: { authorization: 'Bearer test-job-token' } });
    expect(ok.status).toBe(200);
  });

  it('production+token未設定では/jobs/report/*を拒否する', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.LCC_COMMAND_API_TOKENS;
    const res = await app.request('/jobs/report/morning', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('production webhookはsecret未設定なら503で受理しない（偽WebhookでのDB汚染防止）', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.LINEWORKS_WEBHOOK_SECRET;
    const res = await app.request('/webhooks/lineworks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'message' })
    });
    expect(res.status).toBe(503);
  });

  it('production webhookは署名不一致401・正署名は受理する', async () => {
    process.env.NODE_ENV = 'production';
    process.env.LINEWORKS_WEBHOOK_SECRET = 'test-secret';
    const body = JSON.stringify({ type: 'message', source: { userId: 'u1' }, content: { type: 'text', text: 'テスト連絡' } });
    const bad = await app.request('/webhooks/lineworks', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-works-signature': 'invalid' }, body
    });
    expect(bad.status).toBe(401);
    const sig = createHmac('sha256', 'test-secret').update(body).digest('base64');
    const good = await app.request('/webhooks/lineworks', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-works-signature': sig }, body
    });
    expect([200, 400]).toContain(good.status); // 署名通過（400はpayload形式差のみ許容）
    expect(good.status).not.toBe(401);
  });
});
