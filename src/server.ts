import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { analyzeMessage } from './ai/analyzeMessage.js';
import type { AnalyzeMessageInput, MessageSource, OriginalChannel } from './domain/types.js';
import { analyzeAndSaveMessage } from './jobs/analyzeIncomingMessages.js';
import { generateAndSendReport } from './jobs/generateReports.js';
import { createRepository } from './repositories/createRepository.js';
import { createLineworksConnector, type LineworksWebhookPayload } from './connectors/lineworks.js';
import { handleMcpMessage } from './mcp/lineworksMcpServer.js';
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

// claude.ai カスタムコネクタ用 MCP エンドポイント（LINE WORKS送信）。
// LINEWORKS_MCP_TOKEN が未設定の間は無効。トークンはURLの一部として照合する。
const mcpTokenValid = (token: string): boolean => {
  const expected = process.env.LINEWORKS_MCP_TOKEN;
  return Boolean(expected) && token === expected;
};

app.post('/mcp/:token', async (c) => {
  if (!process.env.LINEWORKS_MCP_TOKEN) {
    return c.json({ error: 'mcp endpoint is disabled' }, 404);
  }
  if (!mcpTokenValid(c.req.param('token'))) {
    return c.json({ error: 'forbidden' }, 403);
  }
  try {
    const body = (await c.req.json()) as Record<string, unknown> | Array<Record<string, unknown>>;
    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map((message) => handleMcpMessage(message)))).filter(
        (response) => response !== null
      );
      if (responses.length === 0) return c.body(null, 202);
      return c.json(responses);
    }
    const response = await handleMcpMessage(body);
    if (response === null) return c.body(null, 202);
    return c.json(response);
  } catch (error) {
    return c.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: error instanceof Error ? error.message : 'parse error' } },
      400
    );
  }
});

app.get('/mcp/:token', (c) => c.text('Method Not Allowed', 405));
app.delete('/mcp/:token', (c) => c.body(null, 200));

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
