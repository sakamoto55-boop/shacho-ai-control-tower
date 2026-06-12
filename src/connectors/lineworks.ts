import type { IncomingMessageInput } from '../domain/types.js';
import { nowIso } from '../utils/date.js';
import { sha256 } from '../utils/hash.js';
import { normalizeText } from '../utils/textNormalize.js';

export interface LineworksWebhookPayload {
  eventId?: string;
  roomId?: string;
  roomName?: string;
  userId?: string;
  userName?: string;
  text?: string;
  timestamp?: string;
}

export interface LineworksConnector {
  normalizeWebhookMessage(payload: LineworksWebhookPayload): IncomingMessageInput;
  sendReport(text: string): Promise<{ dryRun: boolean; text: string }>;
  sendNotification(text: string): Promise<{ dryRun: boolean; text: string }>;
}

export class MockLineworksConnector implements LineworksConnector {
  normalizeWebhookMessage(payload: LineworksWebhookPayload): IncomingMessageInput {
    const text = normalizeText(payload.text ?? '');
    return {
      source: 'lineworks',
      externalMessageId: payload.eventId ?? sha256(`${payload.roomId}:${payload.userId}:${text}`),
      receivedAt: payload.timestamp ?? nowIso(),
      senderName: payload.userName ?? payload.userId ?? '',
      senderAddress: payload.userId ?? '',
      roomName: payload.roomName ?? payload.roomId ?? '',
      subject: '',
      text
    };
  }

  async sendReport(text: string): Promise<{ dryRun: boolean; text: string }> {
    return { dryRun: true, text };
  }

  async sendNotification(text: string): Promise<{ dryRun: boolean; text: string }> {
    return { dryRun: true, text };
  }
}

export function createLineworksConnector(): LineworksConnector {
  return new MockLineworksConnector();
}
