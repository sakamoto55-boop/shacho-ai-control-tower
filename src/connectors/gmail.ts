import type { IncomingMessageInput } from '../domain/types.js';
import { nowIso } from '../utils/date.js';
import { sha256 } from '../utils/hash.js';
import { htmlToPlainText, normalizeText, stripQuotedEmail } from '../utils/textNormalize.js';

export interface GmailMessageLike {
  id: string;
  receivedAt?: string;
  fromName?: string;
  fromAddress?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
}

export interface GmailConnector {
  fetchRecentImportantEmails(): Promise<IncomingMessageInput[]>;
  fetchUnreadEmails(): Promise<IncomingMessageInput[]>;
}

export function normalizeGmailMessage(message: GmailMessageLike): IncomingMessageInput {
  const rawText = message.bodyText ?? (message.bodyHtml ? htmlToPlainText(message.bodyHtml) : '');
  const text = stripQuotedEmail(normalizeText(rawText));
  const externalMessageId = message.id || sha256(`${message.fromAddress}:${message.subject}:${text}`);

  return {
    source: 'gmail',
    externalMessageId,
    receivedAt: message.receivedAt ?? nowIso(),
    senderName: message.fromName ?? '',
    senderAddress: message.fromAddress ?? '',
    roomName: '',
    subject: message.subject ?? '',
    text
  };
}

export class MockGmailConnector implements GmailConnector {
  async fetchRecentImportantEmails(): Promise<IncomingMessageInput[]> {
    return [];
  }

  async fetchUnreadEmails(): Promise<IncomingMessageInput[]> {
    return [];
  }
}

interface GmailApiHeader {
  name: string;
  value: string;
}

interface GmailApiPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailApiPart[];
}

interface GmailApiMessage {
  id: string;
  internalDate?: string;
  payload?: GmailApiPart & { headers?: GmailApiHeader[] };
}

export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

/**
 * Gmail APIのMIME構造(payload.parts)を再帰的に探索し、
 * 最初に見つかったtext/plainとtext/htmlの本文を取り出す。
 */
export function extractGmailBody(payload?: GmailApiMessage['payload']): { text: string; html: string } {
  let text = '';
  let html = '';

  function walk(part?: GmailApiPart): void {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data && !text) {
      text = decodeBase64Url(part.body.data);
    } else if (part.mimeType === 'text/html' && part.body?.data && !html) {
      html = decodeBase64Url(part.body.data);
    }
    part.parts?.forEach(walk);
  }

  if (payload?.parts && payload.parts.length > 0) {
    payload.parts.forEach(walk);
  } else if (payload?.body?.data) {
    if (payload.mimeType === 'text/html') html = decodeBase64Url(payload.body.data);
    else text = decodeBase64Url(payload.body.data);
  }

  return { text, html };
}

export function getGmailHeader(headers: GmailApiHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function parseFromHeader(from: string): { name: string; address: string } {
  const match = from.match(/^(.*?)\s*<(.+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ''), address: match[2].trim() };
  }
  return { name: '', address: from.trim() };
}

/**
 * Gmail APIをOAuth2リフレッシュトークンで直接呼び出すConnector。
 * googleapis等の追加依存を避け、Node標準fetchのみで完結させる。
 */
export class GmailApiConnector implements GmailConnector {
  private accessToken?: string;
  private tokenExpiresAt = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
    private readonly query: string
  ) {}

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token'
      })
    });

    if (!res.ok) {
      throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken;
  }

  private async fetchMessagesByQuery(query: string): Promise<IncomingMessageInput[]> {
    const token = await this.getAccessToken();
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok) {
      throw new Error(`Gmail message list failed: ${listRes.status} ${await listRes.text()}`);
    }

    const listData = (await listRes.json()) as { messages?: { id: string }[] };
    const ids = listData.messages ?? [];
    const messages: IncomingMessageInput[] = [];

    for (const { id } of ids) {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!msgRes.ok) continue;

      const msg = (await msgRes.json()) as GmailApiMessage;
      const headers = msg.payload?.headers;
      const from = parseFromHeader(getGmailHeader(headers, 'From'));
      const subject = getGmailHeader(headers, 'Subject');
      const { text, html } = extractGmailBody(msg.payload);

      messages.push(
        normalizeGmailMessage({
          id: msg.id,
          receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : undefined,
          fromName: from.name,
          fromAddress: from.address,
          subject,
          bodyText: text,
          bodyHtml: html
        })
      );
    }

    return messages;
  }

  async fetchRecentImportantEmails(): Promise<IncomingMessageInput[]> {
    return this.fetchMessagesByQuery(this.query || 'newer_than:1d is:important');
  }

  async fetchUnreadEmails(): Promise<IncomingMessageInput[]> {
    return this.fetchMessagesByQuery('is:unread newer_than:1d');
  }
}

export function createGmailConnector(): GmailConnector {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GMAIL_QUERY } = process.env;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    return new GmailApiConnector(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GMAIL_QUERY ?? '');
  }
  return new MockGmailConnector();
}
