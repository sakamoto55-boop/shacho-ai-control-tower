import 'dotenv/config';
/**
 * LAN内常駐subscriber（構成訂正§1-2）。
 *
 * - Pub/Sub Pull: lcc-gmail-events / lcc-lineworks-events を購読（公開HTTPS不要）
 * - Gmail: 通知→ensureWatch(日次)→history差分→InboundPipeline
 * - LINE WORKS: relay発の原文→InboundPipeline（RawEvent永続化成功後にACK）
 * - PC停止中の通知はPub/Sub側に保持→再起動後にbacklog処理
 * - 状態は intelligence/gmail-state.json / subscriber-state.json へ反映（接続状態APIが読む）
 * 起動: npm run subscribers （start-lcc-command.batからはLCC_SUBSCRIBERS=trueで自動起動）
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GoogleSaTokenSource, loadSaCredentials } from '../src/command/integrations/common/googleSaAuth.js';
import { PubsubPullSubscriber } from '../src/command/integrations/common/pubsubPull.js';
import { GmailClient, resolveGmailAuthState } from '../src/command/integrations/gmail/gmailClient.js';
import { ensureWatch, loadGmailState, processGmailNotification, saveGmailState, defaultGmailStateFile } from '../src/command/integrations/gmail/gmailSync.js';
import { IntelligenceStore, defaultIntelligenceDir } from '../src/command/intelligence/store.js';
import { processInboundEvent } from '../src/command/intelligence/inboundPipeline.js';
import { drainLineworksOutbox } from '../src/command/integrations/lineworks/outboxDrain.js';

const PROJECT = process.env.GCP_PROJECT_ID ?? '';
const GMAIL_SUB = process.env.GMAIL_PUBSUB_SUBSCRIPTION ?? (PROJECT ? `projects/${PROJECT}/subscriptions/lcc-gmail-events-pull` : '');
const LW_SUB = process.env.LINEWORKS_PUBSUB_SUBSCRIPTION ?? (PROJECT ? `projects/${PROJECT}/subscriptions/lcc-lineworks-events-pull` : '');
// 耐久outbox（relayがpublish失敗イベントを退避する先）。drainが後続処理として必ず取り込む
const LW_OUTBOX_BUCKET = process.env.LINEWORKS_OUTBOX_BUCKET ?? (PROJECT ? `${PROJECT}-lineworks-outbox` : '');
const stateFile = join(defaultIntelligenceDir(), 'subscriber-state.json');

interface SubscriberState {
  startedAt: string;
  gmail: { lastPullAt: string | null; lastOutcome: string; backlogProcessed: number };
  lineworks: { lastPullAt: string | null; lastOutcome: string; lastEventAt: string | null; processed: number };
}

function saveState(s: SubscriberState): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  renameSync(tmp, stateFile);
}

async function main(): Promise<void> {
  const creds = loadSaCredentials();
  if (!creds) {
    console.error('[subscribers] CONFIG_REQUIRED: GOOGLE_SERVICE_ACCOUNT_FILE未設定のため購読できません');
    process.exit(2);
  }
  if (!GMAIL_SUB && !LW_SUB) {
    console.error('[subscribers] CONFIG_REQUIRED: GCP_PROJECT_ID または *_PUBSUB_SUBSCRIPTION が未設定です');
    process.exit(2);
  }
  const tokenSource = new GoogleSaTokenSource(creds, 'https://www.googleapis.com/auth/pubsub');
  const storageTokenSource = new GoogleSaTokenSource(creds, 'https://www.googleapis.com/auth/devstorage.read_write');
  const store = new IntelligenceStore();
  const state: SubscriberState = {
    startedAt: new Date().toISOString(),
    gmail: { lastPullAt: null, lastOutcome: 'NOT_STARTED', backlogProcessed: 0 },
    lineworks: { lastPullAt: null, lastOutcome: 'NOT_STARTED', lastEventAt: null, processed: 0 }
  };
  saveState(state);

  const gmailAuth = resolveGmailAuthState();
  const gmailClient = gmailAuth.state === 'READY' ? new GmailClient() : null;
  if (gmailAuth.state !== 'READY') {
    console.log(`[subscribers] gmail: ${gmailAuth.state}（購読はLINE WORKSのみ継続）`);
  } else {
    // watch日次更新（起動時+24hごと）
    const refreshWatch = async () => {
      try {
        const gs = await ensureWatch(gmailClient!, loadGmailState());
        saveGmailState(gs);
        console.log(`[subscribers] gmail watch expiration: ${gs.watchExpiration}`);
      } catch (e) {
        console.error(`[subscribers] gmail watch更新失敗: ${e instanceof Error ? e.message : e}`);
      }
    };
    await refreshWatch();
    setInterval(refreshWatch, 24 * 3600_000);
  }

  const dlDir = join(defaultIntelligenceDir(), 'dead-letter');
  const gmailSub = GMAIL_SUB && gmailClient
    ? new PubsubPullSubscriber(tokenSource, GMAIL_SUB, { deadLetterFile: join(dlDir, 'gmail.jsonl') })
    : null;
  const lwSub = LW_SUB
    ? new PubsubPullSubscriber(tokenSource, LW_SUB, { deadLetterFile: join(dlDir, 'lineworks.jsonl') })
    : null;

  console.log('[subscribers] 稼働開始（Ctrl+Cで停止。PC停止中の通知はPub/Subに保持されます）');
  // Pullループ（RESTロングポーリング相当）。障害時はbackoff
  let backoffMs = 0;
  let lastDrainAt = 0;
  for (;;) {
    if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs));
    let hadError = false;
    if (gmailSub && gmailClient) {
      const r = await gmailSub.pullOnce(async (msg) => {
        const n = JSON.parse(msg.data || '{}') as { historyId?: number | string };
        const pr = await processGmailNotification(gmailClient, store, loadGmailState(), n, defaultGmailStateFile());
        if (pr.outcome === 'FETCH_FAILED') throw new Error(pr.error ?? 'fetch failed'); // ACKしない→再配信
        state.gmail.backlogProcessed += pr.processed.filter((p) => p.outcome !== 'DEDUPLICATED').length;
      });
      state.gmail.lastPullAt = new Date().toISOString();
      state.gmail.lastOutcome = r.outcome + (r.error ? `:${r.error.slice(0, 60)}` : '');
      if (r.outcome === 'FETCH_FAILED') hadError = true;
    }
    if (lwSub) {
      const r = await lwSub.pullOnce(async (msg) => {
        const payload = JSON.parse(msg.data || '{}') as Record<string, Record<string, unknown>>;
        const roomId = String(payload.source?.roomId ?? payload.source?.channelId ?? payload.source?.userId ?? 'unknown');
        const text = String((payload.content as Record<string, unknown> | undefined)?.text ?? '');
        const result = processInboundEvent(store, {
          companyId: 'lcc',
          source: 'lineworks',
          externalId: msg.attributes.eventKey || msg.messageId,
          content: payload as Record<string, unknown>,
          text,
          fromLabel: String(payload.source?.userId ?? 'lineworks'),
          watchKey: `lineworks:${roomId}`,
          asOf: msg.attributes.receivedAt ?? null
        });
        state.lineworks.lastEventAt = msg.attributes.receivedAt ?? new Date().toISOString();
        if (result.outcome !== 'DEDUPLICATED') state.lineworks.processed += 1;
      });
      state.lineworks.lastPullAt = new Date().toISOString();
      state.lineworks.lastOutcome = r.outcome + (r.error ? `:${r.error.slice(0, 60)}` : '');
      if (r.outcome === 'FETCH_FAILED') hadError = true;
    }
    saveState(state);
    // 耐久outboxのdrain（60秒間隔目安）。LINE WORKSは再送しないため、publish失敗分の唯一の復旧経路
    if (LW_OUTBOX_BUCKET && Date.now() - lastDrainAt > 60_000) {
      lastDrainAt = Date.now();
      const d = await drainLineworksOutbox(storageTokenSource, LW_OUTBOX_BUCKET, store);
      if (d.outcome === 'DRAINED') {
        state.lineworks.processed += d.processed;
        console.log(`[subscribers] outbox drain: processed=${d.processed} dedup=${d.deduplicated} failed=${d.failed}`);
        saveState(state);
      }
    }
    backoffMs = hadError ? Math.min((backoffMs || 2000) * 2, 60_000) : 1000;
  }
}

main().catch((e) => {
  console.error(`[subscribers] 致命的エラー: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
