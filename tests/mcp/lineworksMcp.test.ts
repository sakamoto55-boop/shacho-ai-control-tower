import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMcpMessage, type McpDependencies } from '../../src/mcp/lineworksMcpServer.js';
import { buildServiceAccountJwt, loadRecipientsFromEnv } from '../../src/connectors/lineworksApi.js';
import { generateKeyPairSync } from 'node:crypto';

function createDeps(overrides: Partial<McpDependencies> = {}): McpDependencies {
  return {
    listRecipients: () => [
      { name: '竹内', type: 'user', id: 'k.takeuchi@example.com' },
      { name: '業務サポート', type: 'channel', id: 'channel-123' }
    ],
    dryRun: () => true,
    sendText: vi.fn(async () => undefined),
    ...overrides
  };
}

describe('handleMcpMessage', () => {
  it('initializeでプロトコルバージョンとツール対応を返す', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      createDeps()
    );
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'shacho-ai-lineworks' }
      }
    });
  });

  it('未知のprotocolVersionにはサーバー側の最新版を返す', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      createDeps()
    );
    expect((response?.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
  });

  it('通知（idなし）にはnullを返す', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      createDeps()
    );
    expect(response).toBeNull();
  });

  it('tools/listで2つのツールを返す', async () => {
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, createDeps());
    const tools = (response?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual(['lineworks_list_recipients', 'lineworks_send_message']);
  });

  it('lineworks_list_recipientsが宛先一覧を返す', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'lineworks_list_recipients', arguments: {} } },
      createDeps()
    );
    const text = (response?.result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain('竹内');
    expect(text).toContain('業務サポート');
    expect(text).toContain('ドライラン: ON');
  });

  it('ドライラン時はsendTextを呼ばずプレビューを返す', async () => {
    const sendText = vi.fn(async () => undefined);
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'lineworks_send_message', arguments: { recipient: '竹内', text: '転送テストです' } }
      },
      createDeps({ sendText })
    );
    const result = response?.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('ドライラン');
    expect(result.content[0].text).toContain('転送テストです');
    expect(sendText).not.toHaveBeenCalled();
  });

  it('ドライランOFF時はsendTextを呼ぶ', async () => {
    const sendText = vi.fn(async () => undefined);
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'lineworks_send_message', arguments: { recipient: '竹内', text: '本番送信' } }
      },
      createDeps({ dryRun: () => false, sendText })
    );
    const result = response?.result as { content: Array<{ text: string }> };
    expect(result.content[0].text).toContain('送信しました');
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText).toHaveBeenCalledWith({ name: '竹内', type: 'user', id: 'k.takeuchi@example.com' }, '本番送信');
  });

  it('許可リストにない宛先はエラーを返し送信しない', async () => {
    const sendText = vi.fn(async () => undefined);
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'lineworks_send_message', arguments: { recipient: '知らない人', text: 'テスト' } }
      },
      createDeps({ dryRun: () => false, sendText })
    );
    const result = response?.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('許可リストに登録されていません');
    expect(sendText).not.toHaveBeenCalled();
  });

  it('未知のメソッドは-32601を返す', async () => {
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 8, method: 'resources/list' }, createDeps());
    expect(response?.error).toMatchObject({ code: -32601 });
  });
});

describe('MCP HTTPエンドポイント', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('LINEWORKS_MCP_TOKEN未設定なら404', async () => {
    vi.stubEnv('LINEWORKS_MCP_TOKEN', '');
    const { app } = await import('../../src/server.js');
    const res = await app.request('/mcp/anything', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    });
    expect(res.status).toBe(404);
  });

  it('トークン不一致なら403', async () => {
    vi.stubEnv('LINEWORKS_MCP_TOKEN', 'correct-token');
    const { app } = await import('../../src/server.js');
    const res = await app.request('/mcp/wrong-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    });
    expect(res.status).toBe(403);
  });

  it('正しいトークンならpingに応答する', async () => {
    vi.stubEnv('LINEWORKS_MCP_TOKEN', 'correct-token');
    const { app } = await import('../../src/server.js');
    const res = await app.request('/mcp/correct-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('GETは405を返す', async () => {
    vi.stubEnv('LINEWORKS_MCP_TOKEN', 'correct-token');
    const { app } = await import('../../src/server.js');
    const res = await app.request('/mcp/correct-token', { method: 'GET' });
    expect(res.status).toBe(405);
  });
});

describe('lineworksApi', () => {
  it('buildServiceAccountJwtがRS256のJWTを生成する', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const jwt = buildServiceAccountJwt(
      {
        clientId: 'client-id',
        clientSecret: 'secret',
        serviceAccount: 'sa@example',
        privateKey: pem,
        botId: 'bot-1'
      },
      1_700_000_000
    );
    const [header, payload, signature] = jwt.split('.');
    expect(signature.length).toBeGreaterThan(0);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iss: 'client-id',
      sub: 'sa@example',
      iat: 1_700_000_000,
      exp: 1_700_003_600
    });
  });

  it('loadRecipientsFromEnvが不正なJSONで空配列を返す', () => {
    expect(loadRecipientsFromEnv({ LINEWORKS_RECIPIENTS: '{broken' } as NodeJS.ProcessEnv)).toEqual([]);
    expect(loadRecipientsFromEnv({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(
      loadRecipientsFromEnv({
        LINEWORKS_RECIPIENTS: '[{"name":"竹内","type":"user","id":"a@b.c"},{"name":"bad","type":"x","id":"y"}]'
      } as NodeJS.ProcessEnv)
    ).toEqual([{ name: '竹内', type: 'user', id: 'a@b.c' }]);
  });
});
