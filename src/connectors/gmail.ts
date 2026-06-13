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
  fetchUnrepliedEmails(): Promise<IncomingMessageInput[]>;
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

  async fetchUnrepliedEmails(): Promise<IncomingMessageInput[]> {
    return [];
  }
}

export function createGmailConnector(): GmailConnector {
  return new MockGmailConnector();
}
