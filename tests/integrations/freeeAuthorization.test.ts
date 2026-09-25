import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createFreeeAuthorizationHandler, FREEE_AUTH_TIMEOUT_MS } from '../../src/command/integrations/freee/freeeAuthorization.js';

const redirectUri = 'http://127.0.0.1:8790/freee/callback';
const state = 'random-test-state';

function response() {
  const result = { status: 0, body: '', headers: {} as Record<string, string> };
  const res = {
    writeHead(status: number, headers: Record<string, string>) { result.status = status; result.headers = headers; return res; },
    end(body: string) { result.body = body; }
  };
  return { result, res: res as unknown as ServerResponse };
}

function request(query: string, method = 'GET', host = '127.0.0.1:8790') {
  return { method, headers: { host }, url: `/freee/callback?${query}` } as IncomingMessage;
}

describe('freee authorization callback', () => {
  it.each([
    ['code=secret', 'GET', '127.0.0.1:8790'],
    ['code=secret&state=other', 'GET', '127.0.0.1:8790'],
    [`code=secret&state=${state}&state=${state}`, 'GET', '127.0.0.1:8790'],
    [`code=one&code=two&state=${state}`, 'GET', '127.0.0.1:8790'],
    [`code=secret&state=${state}`, 'POST', '127.0.0.1:8790'],
    [`code=secret&state=${state}`, 'GET', 'evil.example:8790']
  ])('不正なcallbackを交換せず秘密を応答へ含めない: %s', async (query, method, host) => {
    const exchangeCode = vi.fn();
    const finished = vi.fn();
    const handler = createFreeeAuthorizationHandler({ redirectUri, state, exchangeCode, finished });
    const { result, res } = response();
    await handler(request(query, method, host), res);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body).not.toContain('secret');
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
  });

  it('同時callback・再送でも交換は1回だけ', async () => {
    let complete!: () => void;
    const exchangeCode = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const finished = vi.fn();
    const handler = createFreeeAuthorizationHandler({ redirectUri, state, exchangeCode, finished });
    const first = response();
    const pending = handler(request(`code=one&state=${state}`), first.res);
    const second = response();
    await handler(request(`code=two&state=${state}`), second.res);
    expect(second.result.status).toBe(410);
    complete();
    await pending;
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(exchangeCode).toHaveBeenCalledWith('one');
    expect(first.result.status).toBe(200);
    expect(first.result.headers['Cache-Control']).toBe('no-store');
    expect(finished).toHaveBeenCalledWith(true);
  });

  it('認可拒否は失敗で終了し、エラーの自由文を表示しない', async () => {
    const exchangeCode = vi.fn();
    const finished = vi.fn();
    const handler = createFreeeAuthorizationHandler({ redirectUri, state, exchangeCode, finished });
    const { result, res } = response();
    await handler(request(`error=access_denied&error_description=private&state=${state}`), res);
    expect(result.status).toBe(400);
    expect(result.body).not.toContain('private');
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(finished).toHaveBeenCalledWith(false);
  });

  it('交換失敗を成功扱いせず再利用を拒否する', async () => {
    const exchangeCode = vi.fn().mockRejectedValue(new Error('private-token'));
    const finished = vi.fn();
    const handler = createFreeeAuthorizationHandler({ redirectUri, state, exchangeCode, finished });
    const first = response();
    await handler(request(`code=one&state=${state}`), first.res);
    expect(first.result.status).toBe(500);
    expect(first.result.body).not.toContain('private-token');
    expect(finished).toHaveBeenCalledWith(false);
    const second = response();
    await handler(request(`code=one&state=${state}`), second.res);
    expect(second.result.status).toBe(410);
    expect(exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('期限切れは交換前に拒否する', async () => {
    let time = 0;
    const exchangeCode = vi.fn();
    const handler = createFreeeAuthorizationHandler({ redirectUri, state, exchangeCode, finished: vi.fn(), now: () => time });
    time = FREEE_AUTH_TIMEOUT_MS;
    const { result, res } = response();
    await handler(request(`code=one&state=${state}`), res);
    expect(result.status).toBe(410);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it.each(['https://example.org/callback', 'http://0.0.0.0:8790/freee/callback', `${redirectUri}?unexpected=1`])(
    'loopback以外・設定の曖昧なcallbackで待受しない: %s', (uri) => {
      expect(() => createFreeeAuthorizationHandler({ redirectUri: uri, state, exchangeCode: vi.fn(), finished: vi.fn() })).toThrow('127.0.0.1');
    }
  );
});
