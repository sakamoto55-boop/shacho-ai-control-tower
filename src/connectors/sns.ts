import type { SnsChannel, SnsInquiryInput, SnsPostDraftRecord } from '../domain/types.js';
import { nowIso } from '../utils/date.js';
import { sha256 } from '../utils/hash.js';
import { normalizeText } from '../utils/textNormalize.js';

/** SNSのDM・コメントを受け取るWebhookの共通形。各SNSの生ペイロードはここへ寄せる。 */
export interface SnsInquiryWebhookPayload {
  channel?: SnsChannel;
  inquiryId?: string;
  accountName?: string;
  displayName?: string;
  text?: string;
  postRef?: string;
  area?: string;
  contact?: string;
  timestamp?: string;
}

export interface SnsPublishResult {
  dryRun: boolean;
  channel: SnsChannel;
  scheduledAt: string;
  body: string;
}

export interface SnsMetrics {
  channel: SnsChannel;
  date: string;
  impressions: number;
  profileVisits: number;
  inquiries: number;
}

export interface SnsConnector {
  normalizeWebhookInquiry(payload: SnsInquiryWebhookPayload): SnsInquiryInput;
  /** 承認済みの投稿を公開する。Phase 1は常にdry-runで、実際には投稿しない。 */
  publishPost(draft: SnsPostDraftRecord): Promise<SnsPublishResult>;
  fetchRecentInquiries(): Promise<SnsInquiryInput[]>;
  fetchMetrics(): Promise<SnsMetrics[]>;
}

/**
 * Phase 1のモック実装。
 * 各SNSのAPI接続はPhase 2で実装する。ここでは投稿を一切送信しない。
 */
export class MockSnsConnector implements SnsConnector {
  normalizeWebhookInquiry(payload: SnsInquiryWebhookPayload): SnsInquiryInput {
    const text = normalizeText(payload.text ?? '');
    const channel = payload.channel ?? 'web_form';
    return {
      channel,
      externalInquiryId:
        payload.inquiryId ?? sha256(`${channel}:${payload.accountName ?? ''}:${text}`),
      receivedAt: payload.timestamp ?? nowIso(),
      accountName: payload.accountName ?? '',
      displayName: payload.displayName ?? '',
      text,
      postRef: payload.postRef,
      area: payload.area,
      contact: payload.contact
    };
  }

  async publishPost(draft: SnsPostDraftRecord): Promise<SnsPublishResult> {
    // Phase 1では実投稿しない。承認フローと記録だけを先に固める。
    return {
      dryRun: true,
      channel: draft.channel,
      scheduledAt: `${draft.scheduledDate} ${draft.scheduledTime}`,
      body: draft.body
    };
  }

  async fetchRecentInquiries(): Promise<SnsInquiryInput[]> {
    return [];
  }

  async fetchMetrics(): Promise<SnsMetrics[]> {
    return [];
  }
}

export function createSnsConnector(): SnsConnector {
  return new MockSnsConnector();
}
