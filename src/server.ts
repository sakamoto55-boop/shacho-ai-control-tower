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
// CODEX是正2: UI配信へセキュリティヘッダーを付与（inline script/styleを使う単一HTML構成のため
// script-src/style-srcは'self'+'unsafe-inline'。外部originは全ブロック=CDN依存ゼロを強制）
const UI_SECURITY_HEADERS: Record<string, string> = {
  // 注: 単一HTML+Vue runtimeテンプレートの制約でinline/evalを許可（Vueのテンプレートcompileがnew Functionを使用）。
  // 主目的の「外部originの全遮断=CDN依存ゼロの強制」はdefault-src 'self'で維持される
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};

app.get('/vui', async (c) => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../docs/lcc-command-vui.html', import.meta.url), 'utf8');
  const info = resolveVuiBuildInfo();
  for (const [k, v] of Object.entries(UI_SECURITY_HEADERS)) c.header(k, v);
  return c.html(
    html
      .replace('__LCC_BUILD_BRANCH__', info.branch)
      .replace('__LCC_BUILD_COMMIT__', info.commit)
      .replace('__LCC_SERVED_AT__', `${info.servedFrom} JST起動`)
  );
});

// ローカルbundle配信（vue/tailwind。ディレクトリトラバーサル禁止・許可ファイルのみ）
const VENDOR_FILES: Record<string, string> = {
  'vue.global.prod.js': 'text/javascript; charset=utf-8',
  'tw.css': 'text/css; charset=utf-8'
};
app.get('/vendor/:file', async (c) => {
  const file = c.req.param('file');
  const type = VENDOR_FILES[file];
  if (!type) return c.notFound();
  const { readFile } = await import('node:fs/promises');
  const body = await readFile(new URL(`../docs/vendor/${file}`, import.meta.url));
  for (const [k, v] of Object.entries(UI_SECURITY_HEADERS)) c.header(k, v);
  c.header('Content-Type', type);
  c.header('Cache-Control', 'public, max-age=86400');
  return c.body(body);
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

// CODEX是正4: レポート生成ジョブは認証必須（LCC_COMMAND_API_TOKENSのBearer一致）
const jobAuthorized = (c: { req: { header(name: string): string | undefined } }): boolean => {
  const tokensJson = process.env.LCC_COMMAND_API_TOKENS;
  if (!tokensJson) return process.env.NODE_ENV !== 'production'; // productionでtoken未設定なら拒否
  try {
    const tokens = JSON.parse(tokensJson) as Record<string, unknown>;
    const bearer = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    return Boolean(bearer && tokens[bearer]);
  } catch {
    return false;
  }
};

app.post('/jobs/report/morning', async (c) => {
  if (!jobAuthorized(c)) return c.json({ error: 'unauthorized: レポート実行には認証が必要です' }, 401);
  const report = await generateAndSendReport(repository, 'morning');
  return c.json(report);
});

app.post('/jobs/report/noon', async (c) => {
  if (!jobAuthorized(c)) return c.json({ error: 'unauthorized: レポート実行には認証が必要です' }, 401);
  const report = await generateAndSendReport(repository, 'noon');
  return c.json(report);
});

app.post('/jobs/report/evening', async (c) => {
  if (!jobAuthorized(c)) return c.json({ error: 'unauthorized: レポート実行には認証が必要です' }, 401);
  const report = await generateAndSendReport(repository, 'evening');
  return c.json(report);
});

app.post('/webhooks/lineworks', async (c) => {
  try {
    // CODEX是正4: productionは署名検証必須。secret未設定なら受理しない（偽Webhookでの受信箱汚染防止）
    if (process.env.NODE_ENV === 'production') {
      const secret = process.env.LINEWORKS_WEBHOOK_SECRET;
      if (!secret) {
        return c.json({ error: 'webhook rejected: LINEWORKS_WEBHOOK_SECRET未設定のためproductionでは受理しません' }, 503);
      }
      const rawBody = await c.req.raw.clone().text();
      const signature = c.req.header('x-works-signature') ?? '';
      const { createHmac, timingSafeEqual } = await import('node:crypto');
      const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
      const valid =
        signature.length === expected.length &&
        timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      if (!valid) return c.json({ error: 'webhook rejected: 署名が一致しません' }, 401);
    }
    const payload = (await c.req.json()) as LineworksWebhookPayload;
    const connector = createLineworksConnector();
    const input = connector.normalizeWebhookMessage(payload);
    const bundle = await analyzeAndSaveMessage(repository, input);
    // DIOS §5: RawEventへ冪等登録（再送・リプレイ・重複eventを排除）+ 返信待ちタスクの自動再開。
    // 本文は外部入力として保存のみ（本文中の指示をシステム命令として実行しない）
    let intelligence: { deduplicated: boolean; resumedActions: number; classification: string } | null = null;
    try {
      const { IntelligenceStore } = await import('./command/intelligence/store.js');
      const { classifyInbound } = await import('./command/intelligence/classify.js');
      const store = new IntelligenceStore();
      const p = payload as unknown as Record<string, Record<string, unknown>>;
      const roomId = String(p.source?.roomId ?? p.source?.channelId ?? p.source?.userId ?? 'unknown');
      const text = String((p.content as Record<string, unknown> | undefined)?.text ?? '');
      const externalId = String(
        (p as Record<string, unknown>).eventId ?? (p.content as Record<string, unknown> | undefined)?.messageId ?? `${roomId}:${text.slice(0, 40)}`
      );
      const { deduplicated } = store.ingestRawEvent({
        companyId: 'lcc', source: 'lineworks', externalId, content: payload as unknown as Record<string, unknown>
      });
      const resumed = deduplicated ? [] : store.resumeWaitingByWatchKey(`lineworks:${roomId}`);
      intelligence = { deduplicated, resumedActions: resumed.length, classification: classifyInbound(text).kind };
    } catch { /* 取込層の失敗で受信自体は止めない */ }
    return c.json({ ok: true, bundle, intelligence });
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
