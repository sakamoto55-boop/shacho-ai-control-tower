import { createSign } from 'node:crypto';
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

// ----------------------------------------------------------------
// Mock (no credentials)
// ----------------------------------------------------------------
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

// ----------------------------------------------------------------
// Real connector using LINE WORKS Bot API v2
// ----------------------------------------------------------------

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildJwt(clientId: string, serviceAccount: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 3600 })
  );
  const signingInput = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = base64url(sign.sign(privateKeyPem));
  return `${signingInput}.${signature}`;
}

async function fetchAccessToken(
  clientId: string,
  clientSecret: string,
  serviceAccount: string,
  privateKeyPem: string
): Promise<string> {
  const jwt = buildJwt(clientId, serviceAccount, privateKeyPem);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'bot'
  });
  const res = await fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LINE WORKS token error ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('LINE WORKS token response missing access_token');
  return json.access_token;
}

async function sendBotMessage(
  accessToken: string,
  botId: string,
  channelId: string,
  text: string
): Promise<void> {
  // LINE WORKS text message limit is 2000 chars
  const safeText = text.length > 2000 ? text.slice(0, 1997) + '…' : text;
  const url = `https://www.worksapis.com/v1.0/bots/${botId}/channels/${channelId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content: { type: 'text', text: safeText } })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LINE WORKS send error ${res.status}: ${detail}`);
  }
}

export class RealLineworksConnector implements LineworksConnector {
  private readonly botId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly serviceAccount: string;
  private readonly privateKeyPem: string;
  private readonly reportChannelId: string;
  private readonly dryRun: boolean;

  constructor(env: NodeJS.ProcessEnv) {
    this.botId = env.LINEWORKS_BOT_ID ?? '';
    this.clientId = env.LINEWORKS_CLIENT_ID ?? '';
    this.clientSecret = env.LINEWORKS_CLIENT_SECRET ?? '';
    this.serviceAccount = env.LINEWORKS_SERVICE_ACCOUNT ?? '';
    // Allow \n literal in env (common in .env files)
    this.privateKeyPem = (env.LINEWORKS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
    this.reportChannelId = env.LINEWORKS_REPORT_ROOM_ID ?? '';
    this.dryRun = env.LINEWORKS_DRY_RUN !== 'false';
  }

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
    return this._send(text);
  }

  async sendNotification(text: string): Promise<{ dryRun: boolean; text: string }> {
    return this._send(text);
  }

  private async _send(text: string): Promise<{ dryRun: boolean; text: string }> {
    if (this.dryRun) return { dryRun: true, text };

    const token = await fetchAccessToken(
      this.clientId,
      this.clientSecret,
      this.serviceAccount,
      this.privateKeyPem
    );
    await sendBotMessage(token, this.botId, this.reportChannelId, text);
    return { dryRun: false, text };
  }
}

// ----------------------------------------------------------------
// Factory
// ----------------------------------------------------------------

function isRealLineworksConfigured(env: NodeJS.ProcessEnv): boolean {
  return !!(
    env.LINEWORKS_BOT_ID &&
    env.LINEWORKS_CLIENT_ID &&
    env.LINEWORKS_CLIENT_SECRET &&
    env.LINEWORKS_SERVICE_ACCOUNT &&
    env.LINEWORKS_PRIVATE_KEY &&
    env.LINEWORKS_REPORT_ROOM_ID
  );
}

export function createLineworksConnector(): LineworksConnector {
  if (isRealLineworksConfigured(process.env)) {
    return new RealLineworksConnector(process.env);
  }
  return new MockLineworksConnector();
}
