import { google } from 'googleapis';
import type { IncomingMessageInput } from '../domain/types.js';
import { normalizeGmailMessage, type GmailConnector, type GmailMessageLike } from './gmail.js';

interface GmailHeader {
  name: string;
  value: string;
}

function buildOAuth2Client() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractHeader(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseFromHeader(from: string): { name: string; address: string } {
  const match = from.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^["']|["']$/g, ''), address: match[2].trim() };
  }
  return { name: '', address: from.trim() };
}

function extractBodyFromPayload(payload: Record<string, unknown>): { text: string; html: string } {
  let text = '';
  let html = '';

  function walk(part: Record<string, unknown>) {
    const mime = String(part.mimeType ?? '');
    const body = (part.body ?? {}) as { data?: string };
    if (mime === 'text/plain' && body.data) text = decodeBase64Url(body.data);
    else if (mime === 'text/html' && body.data) html = decodeBase64Url(body.data);
    const parts = (part.parts ?? []) as Record<string, unknown>[];
    for (const p of parts) walk(p);
  }

  walk(payload);
  return { text, html };
}

export function isGmailConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

export class RealGmailConnector implements GmailConnector {
  private readonly gmail;
  private readonly myEmail: string;

  constructor() {
    this.gmail = google.gmail({ version: 'v1', auth: buildOAuth2Client() });
    this.myEmail = (process.env.GMAIL_USER_EMAIL ?? '').toLowerCase();
  }

  private async fetchFullMessage(messageId: string): Promise<GmailMessageLike | null> {
    try {
      const res = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });
      const msg = res.data;
      const headers = (msg.payload?.headers ?? []) as GmailHeader[];
      const from = extractHeader(headers, 'From');
      const { name: fromName, address: fromAddress } = parseFromHeader(from);
      const dateStr = extractHeader(headers, 'Date');
      const { text: bodyText, html: bodyHtml } = extractBodyFromPayload(
        (msg.payload ?? {}) as Record<string, unknown>
      );
      return {
        id: messageId,
        receivedAt: dateStr ? new Date(dateStr).toISOString() : undefined,
        fromName,
        fromAddress,
        subject: extractHeader(headers, 'Subject'),
        bodyText,
        bodyHtml
      };
    } catch {
      return null;
    }
  }

  private async queryMessages(q: string, maxResults = 20): Promise<IncomingMessageInput[]> {
    const listRes = await this.gmail.users.messages.list({ userId: 'me', q, maxResults });
    const msgs = listRes.data.messages ?? [];
    const results: IncomingMessageInput[] = [];
    for (const m of msgs) {
      if (!m.id) continue;
      const raw = await this.fetchFullMessage(m.id);
      if (raw) results.push(normalizeGmailMessage(raw));
    }
    return results;
  }

  async fetchUnreadEmails(): Promise<IncomingMessageInput[]> {
    return this.queryMessages('in:inbox is:unread -from:me', 20);
  }

  async fetchRecentImportantEmails(): Promise<IncomingMessageInput[]> {
    return this.queryMessages('in:inbox is:important -from:me newer_than:1d', 10);
  }

  /**
   * Fetches inbox threads where the last message is NOT from the user.
   * These are threads the user has not yet replied to.
   */
  async fetchUnrepliedEmails(): Promise<IncomingMessageInput[]> {
    const listRes = await this.gmail.users.threads.list({
      userId: 'me',
      q: 'in:inbox -from:me',
      maxResults: 25
    });
    const threads = listRes.data.threads ?? [];
    const results: IncomingMessageInput[] = [];

    for (const thread of threads) {
      if (!thread.id) continue;
      try {
        const tRes = await this.gmail.users.threads.get({
          userId: 'me',
          id: thread.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        });
        const messages = tRes.data.messages ?? [];
        if (messages.length === 0) continue;

        const last = messages[messages.length - 1];
        const headers = (last.payload?.headers ?? []) as GmailHeader[];
        const { address: lastFromAddress } = parseFromHeader(extractHeader(headers, 'From'));

        if (this.myEmail && lastFromAddress.toLowerCase().includes(this.myEmail)) continue;

        if (!last.id) continue;
        const raw = await this.fetchFullMessage(last.id);
        if (raw) results.push(normalizeGmailMessage(raw));
      } catch {
        // skip individual thread errors silently
      }
    }
    return results;
  }
}
