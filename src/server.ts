import 'dotenv/config';
import { execSync } from 'node:child_process';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { analyzeMessage } from './ai/analyzeMessage.js';
import type { AnalyzeMessageInput, MessageSource, OriginalChannel } from './domain/types.js';
import { analyzeAndSaveMessage } from './jobs/analyzeIncomingMessages.js';
import { generateAndSendReport } from './jobs/generateReports.js';
import { createRepository } from './repositories/createRepository.js';
import { createLineworksConnector, type LineworksWebhookPayload } from './connectors/lineworks.js';
import { createCommandApp } from './command/server/routes.js';
import { nowIso } from './utils/date.js';
import { isMainModule } from './utils/mainModule.js';

export const app = new Hono();

// LCC COMMAND（会話型AI経営管制OS）を /command 配下へマウント
app.route('/command', createCommandApp());

// UI配信（スマホ等の実機からも http://<PCのIP>:8787/vui で利用できるようにする）
// 配信buildの診断情報は配信時にサーバーが実測値を注入する（UI側の手動stampに依存しない。
// git不在の環境ではLCC_BUILD_*環境変数、なければ'unknown'を注入し、偽のcommitを表示しない）
let vuiBuildInfo: { branch: string; commit: string; servedFrom: string } | null = null;
function resolveVuiBuildInfo(): { branch: string; commit: string; servedFrom: string } {
  if (vuiBuildInfo) return vuiBuildInfo;
  let branch = process.env.LCC_BUILD_BRANCH ?? 'unknown';
  let commit = process.env.LCC_BUILD_COMMIT ?? 'unknown';
  try {
    const cwd = new URL('..', import.meta.url);
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || branch;
    commit = execSync('git rev-parse --short HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || commit;
    const dirty = execSync('git status --porcelain', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (dirty) commit += '+dirty';
  } catch {
    // gitが使えない配備環境では環境変数値または'unknown'のまま（推測でcommitを出さない）
  }
  const servedFrom = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
  vuiBuildInfo = { branch, commit, servedFrom };
  return vuiBuildInfo;
}
app.get('/vui', async (c) => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../docs/lcc-command-vui.html', import.meta.url), 'utf8');
  const info = resolveVuiBuildInfo();
  return c.html(
    html
      .replace('__LCC_BUILD_BRANCH__', info.branch)
      .replace('__LCC_BUILD_COMMIT__', info.commit)
      .replace('__LCC_SERVED_AT__', `${info.servedFrom} JST起動`)
  );
});

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

if (isMainModule(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`社長AI管制塔 Phase 1 listening on http://localhost:${info.port}`);
  });
}
