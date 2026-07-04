import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { analyzeMessage } from './ai/analyzeMessage.js';
import { reviewAsCompanyOperationsTeam } from './ai/team/companyOperationsTeam.js';
import type { AnalyzeMessageInput, MessageSource, OriginalChannel } from './domain/types.js';
import { analyzeAndSaveMessage } from './jobs/analyzeIncomingMessages.js';
import { generateAndSendReport } from './jobs/generateReports.js';
import { createRepository } from './repositories/createRepository.js';
import { createLineworksConnector, type LineworksWebhookPayload } from './connectors/lineworks.js';
import { consoleHtml } from './web/consolePage.js';
import { nowIso } from './utils/date.js';

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

/**
 * CONSOLE_ACCESS_KEYが設定されている場合のみ、/dev/*への全リクエストにキー一致を要求する。
 * 未設定の場合は既存のPhase 1ローカル動作（キー不要）を維持する。
 */
app.use('/dev/*', async (c, next) => {
  const requiredKey = process.env.CONSOLE_ACCESS_KEY;
  if (!requiredKey) {
    await next();
    return;
  }
  const providedKey = c.req.query('key') ?? c.req.header('x-console-key');
  if (providedKey !== requiredKey) {
    return c.text('unauthorized', 401);
  }
  await next();
});

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

app.get('/dev/console', (c) => {
  if (!devEnabled()) {
    return c.text('dev endpoints are disabled', 403);
  }
  return c.html(consoleHtml);
});

app.post('/dev/team-review', async (c) => {
  try {
    requireDevEndpoint();
    const body = (await c.req.json()) as DevAnalyzeBody;
    const input = toAnalyzeInput(body);
    const result = await analyzeMessage(input);
    const team = reviewAsCompanyOperationsTeam(input.text, result);
    return c.json({ input, result, team });
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
