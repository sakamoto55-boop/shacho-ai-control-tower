import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GmailApiConnector,
  MockGmailConnector,
  createGmailConnector,
  decodeBase64Url,
  extractGmailBody,
  getGmailHeader,
  parseFromHeader
} from '../../src/connectors/gmail.js';

function toBase64Url(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

describe('decodeBase64Url', () => {
  it('decodes base64url-encoded text back to the original string', () => {
    expect(decodeBase64Url(toBase64Url('見積を今日中にお願いします'))).toBe('見積を今日中にお願いします');
  });
});

describe('parseFromHeader', () => {
  it('splits a "Name <address>" header into name and address', () => {
    expect(parseFromHeader('田中太郎 <tanaka@example.com>')).toEqual({
      name: '田中太郎',
      address: 'tanaka@example.com'
    });
  });

  it('falls back to using the whole value as the address when there is no name', () => {
    expect(parseFromHeader('tanaka@example.com')).toEqual({ name: '', address: 'tanaka@example.com' });
  });
});

describe('getGmailHeader', () => {
  it('finds a header case-insensitively', () => {
    const headers = [{ name: 'Subject', value: '見積依頼' }];
    expect(getGmailHeader(headers, 'subject')).toBe('見積依頼');
  });

  it('returns an empty string when the header is missing', () => {
    expect(getGmailHeader([], 'Subject')).toBe('');
  });
});

describe('extractGmailBody', () => {
  it('extracts text/plain from a single-part payload', () => {
    const body = extractGmailBody({ mimeType: 'text/plain', body: { data: toBase64Url('本文です') } });
    expect(body.text).toBe('本文です');
    expect(body.html).toBe('');
  });

  it('extracts both text/plain and text/html from nested multipart/alternative parts', () => {
    const body = extractGmailBody({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: toBase64Url('プレーン本文') } },
        {
          mimeType: 'multipart/related',
          parts: [{ mimeType: 'text/html', body: { data: toBase64Url('<p>HTML本文</p>') } }]
        }
      ]
    });
    expect(body.text).toBe('プレーン本文');
    expect(body.html).toBe('<p>HTML本文</p>');
  });
});

describe('createGmailConnector', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns MockGmailConnector when OAuth credentials are not configured', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    expect(createGmailConnector()).toBeInstanceOf(MockGmailConnector);
  });

  it('returns GmailApiConnector when OAuth credentials are configured', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';
    expect(createGmailConnector()).toBeInstanceOf(GmailApiConnector);
  });
});

describe('GmailApiConnector', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes an access token, lists messages, and normalizes each one', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token-abc', expires_in: 3600 }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: 'msg-1' }] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'msg-1',
            internalDate: '1735689600000',
            payload: {
              headers: [
                { name: 'From', value: 'A社 田中様 <tanaka@a-corp.example.com>' },
                { name: 'Subject', value: '解体工事の見積依頼' }
              ],
              mimeType: 'text/plain',
              body: { data: toBase64Url('見積を今日中にお願いします') }
            }
          }),
          { status: 200 }
        )
      );

    const connector = new GmailApiConnector('client-id', 'client-secret', 'refresh-token', 'is:important');
    const messages = await connector.fetchRecentImportantEmails();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      source: 'gmail',
      externalMessageId: 'msg-1',
      senderName: 'A社 田中様',
      senderAddress: 'tanaka@a-corp.example.com',
      subject: '解体工事の見積依頼',
      text: '見積を今日中にお願いします'
    });

    const [tokenCall, listCall] = fetchMock.mock.calls;
    expect(tokenCall[0]).toBe('https://oauth2.googleapis.com/token');
    expect(String(listCall[0])).toContain('is%3Aimportant');
  });

  it('reuses a cached access token instead of refreshing on every call', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token-abc', expires_in: 3600 }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }));

    const connector = new GmailApiConnector('client-id', 'client-secret', 'refresh-token', 'is:important');
    await connector.fetchRecentImportantEmails();
    await connector.fetchRecentImportantEmails();

    const tokenRefreshCalls = fetchMock.mock.calls.filter(([url]) => url === 'https://oauth2.googleapis.com/token');
    expect(tokenRefreshCalls).toHaveLength(1);
  });

  it('throws a descriptive error when the token refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('invalid_grant', { status: 400 }));
    const connector = new GmailApiConnector('client-id', 'client-secret', 'bad-refresh-token', '');
    await expect(connector.fetchUnreadEmails()).rejects.toThrow('Gmail token refresh failed');
  });
});
