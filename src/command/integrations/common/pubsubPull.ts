/**
 * Pub/Sub Pull subscriber（構成訂正§1-2）。
 *
 * - LAN内PCから subscriptions:pull（REST）で購読する。公開HTTPS不要。
 *   注: StreamingPull(gRPC)が仕様上は優先だが、追加依存（grpc）を避けるためRESTロングポーリングを採用。
 *   returnImmediately=falseで実質的なlong pollとなり、遅延要件（秒オーダー）を満たす。
 * - **ACKは処理コールバックが成功した後のみ**。失敗はACKせず再配信させる。
 * - 同一messageIdのN回連続失敗はdead-letterファイルへ隔離してACK（毒メッセージでの詰まり防止・内容は保全）。
 * - PC停止中のメッセージはPub/Sub側に保持され、再起動後にbacklogとして届く。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GoogleSaTokenSource } from './googleSaAuth.js';

export interface PubsubMessage {
  messageId: string;
  publishTime: string;
  /** base64 decode済みデータ */
  data: string;
  attributes: Record<string, string>;
}

export interface PullResult {
  outcome: 'NEW_EVENTS' | 'NO_NEW_EVENTS' | 'FETCH_FAILED';
  processed: number;
  acked: number;
  deadLettered: number;
  error?: string;
}

const PUBSUB_BASE = 'https://pubsub.googleapis.com/v1';

export class PubsubPullSubscriber {
  private failureCounts = new Map<string, number>();

  constructor(
    private readonly tokenSource: GoogleSaTokenSource,
    private readonly subscription: string, // projects/<p>/subscriptions/<s>
    private readonly options: {
      deadLetterFile: string;
      maxFailuresBeforeDeadLetter?: number;
      fetchImpl?: typeof fetch;
    }
  ) {}

  private get fetchImpl(): typeof fetch { return this.options.fetchImpl ?? fetch; }

  /** 1回のpull→処理→ACK。handlerが例外を投げたメッセージはACKしない */
  async pullOnce(handler: (msg: PubsubMessage) => Promise<void>, maxMessages = 10): Promise<PullResult> {
    let token: string;
    try { token = await this.tokenSource.getToken(); }
    catch (e) { return { outcome: 'FETCH_FAILED', processed: 0, acked: 0, deadLettered: 0, error: e instanceof Error ? e.message : String(e) }; }

    let received: Array<{ ackId: string; message: { messageId?: string; publishTime?: string; data?: string; attributes?: Record<string, string> } }>;
    try {
      const res = await this.fetchImpl(`${PUBSUB_BASE}/${this.subscription}:pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ maxMessages })
      });
      if (!res.ok) return { outcome: 'FETCH_FAILED', processed: 0, acked: 0, deadLettered: 0, error: `HTTP ${res.status}` };
      const body = (await res.json()) as { receivedMessages?: typeof received };
      received = body.receivedMessages ?? [];
    } catch (e) {
      return { outcome: 'FETCH_FAILED', processed: 0, acked: 0, deadLettered: 0, error: e instanceof Error ? e.message : String(e) };
    }
    if (received.length === 0) return { outcome: 'NO_NEW_EVENTS', processed: 0, acked: 0, deadLettered: 0 };

    const ackIds: string[] = [];
    let deadLettered = 0;
    for (const r of received) {
      const msg: PubsubMessage = {
        messageId: r.message.messageId ?? '',
        publishTime: r.message.publishTime ?? '',
        data: r.message.data ? Buffer.from(r.message.data, 'base64').toString('utf8') : '',
        attributes: r.message.attributes ?? {}
      };
      try {
        await handler(msg);
        ackIds.push(r.ackId); // 永続化成功後のみACK
        this.failureCounts.delete(msg.messageId);
      } catch (e) {
        const n = (this.failureCounts.get(msg.messageId) ?? 0) + 1;
        this.failureCounts.set(msg.messageId, n);
        if (n >= (this.options.maxFailuresBeforeDeadLetter ?? 5)) {
          mkdirSync(dirname(this.options.deadLetterFile), { recursive: true });
          appendFileSync(this.options.deadLetterFile, `${JSON.stringify({ deadLetteredAt: new Date().toISOString(), reason: e instanceof Error ? e.message.slice(0, 200) : String(e), message: msg })}\n`, 'utf8');
          ackIds.push(r.ackId); // 隔離済みなのでACK（内容はdead-letterに保全）
          deadLettered += 1;
          this.failureCounts.delete(msg.messageId);
        }
        // それ以外はACKしない→Pub/Subが再配信する
      }
    }
    if (ackIds.length > 0) {
      try {
        await this.fetchImpl(`${PUBSUB_BASE}/${this.subscription}:acknowledge`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ ackIds })
        });
      } catch { /* ACK失敗は再配信されるだけ（冪等性はRawEvent側で担保） */ }
    }
    return { outcome: 'NEW_EVENTS', processed: received.length, acked: ackIds.length, deadLettered };
  }
}
