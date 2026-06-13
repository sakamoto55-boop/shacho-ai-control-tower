import { google } from 'googleapis';
import type { NotificationResult } from './NotificationResult.js';

function buildOAuth2Client() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

function encodeBase64Url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildRawEmail(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64')
  ];
  return encodeBase64Url(lines.join('\r\n'));
}

export function isGmailNotifierConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.GMAIL_NOTIFY_TO
  );
}

export async function sendGmailNotification(
  subject: string,
  body: string
): Promise<NotificationResult> {
  const to = process.env.GMAIL_NOTIFY_TO ?? '';

  if (!isGmailNotifierConfigured()) {
    return { channel: 'gmail', sent: false, dryRun: true };
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: buildOAuth2Client() });
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: buildRawEmail(to, subject, body) }
    });
    return { channel: 'gmail', sent: true, dryRun: false };
  } catch (err) {
    return {
      channel: 'gmail',
      sent: false,
      dryRun: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
