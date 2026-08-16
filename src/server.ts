import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { analyzeMessage, createAIProvider } from './ai/analyzeMessage.js';
import type {
  AnalyzeMessageInput,
  MessageSource,
  OriginalChannel,
  SnsChannel
} from './domain/types.js';
import { analyzeAndSaveMessage } from './jobs/analyzeIncomingMessages.js';
import { generateAndSendReport, generateAndSendRevenueReport } from './jobs/generateReports.js';
import { followUpLeads, ingestSnsInquiry } from './jobs/snsLeadPipeline.js';
import { approveSnsPostDraft, planSnsPosts, publishApprovedSnsPosts } from './jobs/snsPostJobs.js';
import { createRepository } from './repositories/createRepository.js';
import { createLineworksConnector, type LineworksWebhookPayload } from './connectors/lineworks.js';
import { createSnsConnector, type SnsInquiryWebhookPayload } from './connectors/sns.js';
import { nowIso, todayIsoDate } from './utils/date.js';

export const app = new Hono();

const devEnabled = () => process.env.ENABLE_DEV_ENDPOINTS !== 'false' && process.env.NODE_ENV !== 'production';
const repository = createRepository();

interface DevAnalyzeBody {
  source?: MessageSource;
  externalMessageId?: string;
  originalChannel?: OriginalChannel;
  receivedAt?: string;
  senderName?: string;
  senderAddress?: string;
  roomName?: string;
  subject?: string;
  text?: string;
}

function toAnalyzeInput(body: DevAnalyzeBody): AnalyzeMessageInput {
  if (!body.text || body.text.trim().length === 0) {
    throw new Error('text is required');
  }

  return {
    source: body.source ?? 'manual_import',
    externalMessageId: body.externalMessageId,
    originalChannel: body.originalChannel,
    receivedAt: body.receivedAt ?? nowIso(),
    senderName: body.senderName ?? '',
    senderAddress: body.senderAddress ?? '',
    roomName: body.roomName ?? '',
    subject: body.subject ?? '',
    text: body.text
  };
}

function requireDevEndpoint() {
  if (!devEnabled()) {
    throw new Error('dev endpoints are disabled');
  }
}

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'shacho-ai-control-tower',
    phase: '1',
    storage: process.env.STORAGE_DRIVER ?? 'local',
    aiProvider: process.env.AI_PROVIDER ?? 'mock',
    timestamp: nowIso()
  })
);

app.post('/dev/analyze-text', async (c) => {
  try {
    requireDevEndpoint();
    const body = (await c.req.json()) as DevAnalyzeBody;
    const input = toAnalyzeInput(body);
    const result = await analyzeMessage(input);
    return c.json({ input, result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.post('/dev/analyze-and-save', async (c) => {
  try {
    requireDevEndpoint();
    const body = (await c.req.json()) as DevAnalyzeBody;
    const input = toAnalyzeInput(body);
    const bundle = await analyzeAndSaveMessage(repository, input);
    return c.json(bundle);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.get('/dev/inbox', async (c) => {
  try {
    requireDevEndpoint();
    const records = await repository.getInboxRecordsByDateRange();
    return c.json({ records });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.get('/dev/tasks', async (c) => {
  try {
    requireDevEndpoint();
    const records = await repository.getTasksByDateRange();
    return c.json({ records });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.get('/dev/reply-drafts', async (c) => {
  try {
    requireDevEndpoint();
    const records = await repository.getReplyDraftsByDateRange();
    return c.json({ records });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.post('/jobs/report/morning', async (c) => {
  const report = await generateAndSendReport(repository, 'morning');
  return c.json(report);
});

app.post('/jobs/report/noon', async (c) => {
  const report = await generateAndSendReport(repository, 'noon');
  return c.json(report);
});

app.post('/jobs/report/evening', async (c) => {
  const report = await generateAndSendReport(repository, 'evening');
  return c.json(report);
});

/* ------------------------------------------------------------------ *
 * SNS集客・収益化
 * ------------------------------------------------------------------ */

interface PlanSnsPostsBody {
  fromDate?: string;
  days?: number;
  channels?: SnsChannel[];
  area?: string;
  highlights?: string[];
}

app.post('/webhooks/sns/inquiry', async (c) => {
  try {
    const payload = (await c.req.json()) as SnsInquiryWebhookPayload;
    const input = createSnsConnector().normalizeWebhookInquiry(payload);
    if (input.text.length === 0) {
      throw new Error('text is required');
    }
    const bundle = await ingestSnsInquiry(repository, input);
    return c.json({ ok: true, bundle });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.post('/dev/sns/analyze-inquiry', async (c) => {
  try {
    requireDevEndpoint();
    const payload = (await c.req.json()) as SnsInquiryWebhookPayload;
    const input = createSnsConnector().normalizeWebhookInquiry(payload);
    if (input.text.length === 0) {
      throw new Error('text is required');
    }
    const result = await createAIProvider().analyzeSnsInquiry(input);
    return c.json({ input, result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.get('/dev/sns/leads', async (c) => {
  try {
    requireDevEndpoint();
    const records = await repository.getLeadsByDateRange();
    return c.json({ records });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.get('/dev/sns/post-drafts', async (c) => {
  try {
    requireDevEndpoint();
    const records = await repository.getSnsPostDraftsByDateRange();
    return c.json({ records });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.post('/dev/sns/post-drafts/:id/approve', async (c) => {
  try {
    requireDevEndpoint();
    const result = await approveSnsPostDraft(repository, c.req.param('id'));
    return c.json(result, result.ok ? 200 : 400);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.post('/jobs/sns/plan-posts', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as PlanSnsPostsBody;
    const result = await planSnsPosts(repository, {
      fromDate: body.fromDate ?? todayIsoDate(),
      days: body.days ?? 7,
      channels: body.channels,
      area: body.area ?? process.env.SNS_DEFAULT_AREA,
      highlights: body.highlights
    });
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.post('/jobs/sns/follow-up', async (c) => {
  const result = await followUpLeads(repository);
  return c.json(result);
});

app.post('/jobs/sns/publish-approved', async (c) => {
  const result = await publishApprovedSnsPosts(repository);
  return c.json(result);
});

app.post('/jobs/report/revenue', async (c) => {
  const report = await generateAndSendRevenueReport(repository);
  return c.json(report);
});

app.post('/webhooks/lineworks', async (c) => {
  try {
    const payload = (await c.req.json()) as LineworksWebhookPayload;
    const connector = createLineworksConnector();
    const input = connector.normalizeWebhookMessage(payload);
    const bundle = await analyzeAndSaveMessage(repository, input);
    return c.json({ ok: true, bundle });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`社長AI管制塔 Phase 1 listening on http://localhost:${info.port}`);
  });
}
