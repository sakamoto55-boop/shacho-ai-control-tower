import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FreeeClient,
  resolveAuthState,
  saveTokens,
  type FreeeConfig
} from '../../src/command/integrations/freee/freeeClient.js';

let dir: string;
let config: FreeeConfig;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lcc-freee-'));
  config = {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://127.0.0.1:8790/freee/callback',
    tokenFile: join(dir, 'secure', 'freee-tokens.json')
  };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type MockCall = { url: string; method: string; body?: string };

function mockFetch(responses: Array<{ ok: boolean; status: number; json: unknown }>) {
  const calls: MockCall[] = [];
  const impl = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    const res = responses.shift() ?? { ok: false, status: 599, json: {} };
    return {
      ok: res.ok,
      status: res.status,
      headers: { get: () => null },
      json: async () => res.json
    };
  };
  return { impl, calls };
}

describe('freee auth state', () => {
  it('Client未設定はADMIN_SETUP_REQUIRED', () => {
    const state = resolveAuthState({ ...config, clientId: undefined });
    expect(state.state).toBe('ADMIN_SETUP_REQUIRED');
  });

  it('token未取得はAUTH_REQUIREDで認可URLを返す', () => {
    const state = resolveAuthState(config);
    expect(state.state).toBe('AUTH_REQUIRED');
    if (state.state === 'AUTH_REQUIRED') {
      expect(state.authorizeUrl).toContain('accounts.secure.freee.co.jp');
      expect(state.authorizeUrl).toContain('response_type=code');
    }
  });

  it('保存済みtokenがあればREADY', () => {
    saveTokens(config, { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000, scope: 'hr:read' });
    expect(resolveAuthState(config).state).toBe('READY');
  });
});

describe('FreeeClient', () => {
  it('認可コード交換でtokenを保存する（OAuth POSTのみ）', async () => {
    const { impl, calls } = mockFetch([
      { ok: true, status: 200, json: { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, scope: 'hr:read' } }
    ]);
    const client = new FreeeClient(config, impl, () => 1_000_000);
    await client.exchangeCode('auth-code');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/public_api/token');
    expect(existsSync(config.tokenFile)).toBe(true);
    const saved = JSON.parse(readFileSync(config.tokenFile, 'utf8'));
    expect(saved.accessToken).toBe('at1');
  });

  it('期限切れtokenはGET前に自動refreshする', async () => {
    saveTokens(config, { accessToken: 'old', refreshToken: 'rt', expiresAt: 1_000, scope: 'hr:read' });
    const { impl, calls } = mockFetch([
      { ok: true, status: 200, json: { access_token: 'new', refresh_token: 'rt2', expires_in: 3600, scope: 'hr:read' } },
      { ok: true, status: 200, json: { companies: [{ id: 1, name: 'LCC' }] } }
    ]);
    const client = new FreeeClient(config, impl, () => 2_000_000);
    const companies = await client.listCompanies();
    expect(companies[0].name).toBe('LCC');
    expect(calls[0].url).toContain('/public_api/token'); // refresh
    expect(calls[1].method).toBe('GET');
  });

  it('429は指数バックオフで再試行しGET以外を発行しない', async () => {
    saveTokens(config, { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000, scope: 'hr:read' });
    const { impl, calls } = mockFetch([
      { ok: false, status: 429, json: {} },
      { ok: true, status: 200, json: { employees: [] } }
    ]);
    const client = new FreeeClient(config, impl);
    const employees = await client.listEmployees(1);
    expect(employees).toEqual([]);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.length).toBe(2);
  });
});
