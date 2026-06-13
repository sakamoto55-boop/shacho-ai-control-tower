import type { NotificationResult } from './NotificationResult.js';

export function isSlackConfigured(): boolean {
  return !!process.env.SLACK_WEBHOOK_URL;
}

export async function sendSlackNotification(
  text: string,
  summary: { priorityA: number; risks: number; total: number }
): Promise<NotificationResult> {
  const url = process.env.SLACK_WEBHOOK_URL;

  if (!url) {
    return { channel: 'slack', sent: false, dryRun: true };
  }

  const color = summary.priorityA > 0 || summary.risks > 0 ? '#E53E3E' : '#DD6B20';
  const header =
    summary.priorityA > 0
      ? `🔴 優先度A: ${summary.priorityA}件` + (summary.risks > 0 ? ` ｜ リスク: ${summary.risks}件` : '')
      : summary.risks > 0
        ? `⚠ リスク検知: ${summary.risks}件`
        : `📬 要対応: ${summary.total}件`;

  const payload = {
    attachments: [
      {
        color,
        fallback: text.slice(0, 200),
        title: header,
        text: text.slice(0, 2800),
        mrkdwn_in: ['text']
      }
    ]
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      return {
        channel: 'slack',
        sent: false,
        dryRun: false,
        error: `HTTP ${res.status}: ${await res.text()}`
      };
    }
    return { channel: 'slack', sent: true, dryRun: false };
  } catch (err) {
    return {
      channel: 'slack',
      sent: false,
      dryRun: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
