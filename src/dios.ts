import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { isMainModule } from './utils/mainModule.js';
import { mountDiosShell, type DiosRuntimeMode } from './dios/runtime.js';

export function selectRuntime(env: NodeJS.ProcessEnv): DiosRuntimeMode {
  const mode = env.DIOS_RUNTIME_MODE ?? 'local';
  if (mode !== 'local' && mode !== 'preview') throw new Error('DIOS_RUNTIME_MODE must be local or preview');
  // 現行正本はローカルファイル保存。Cloud Runへ載せるだけでは永続化されない。
  // 未移行のデータ消失・複数インスタンス競合を、フラグだけで迂回させない。
  if (env.K_SERVICE && mode !== 'preview') {
    throw new Error('DIOS_STORAGE_GATE: Cloud Runの業務稼働は永続ストレージ移行・認証検収まで停止中です');
  }
  return mode;
}

export async function createDiosApp(mode: DiosRuntimeMode): Promise<Hono> {
  let app: Hono;
  if (mode === 'preview') {
    // 公開画面検証は業務APIそのものを読み込まない。資格情報や実データを使わない。
    app = new Hono();
    app.get('/health', (c) => c.json({ ok: true, service: 'DIOS', mode: 'preview', productionReady: false }));
    app.all('/command/*', (c) => c.json({ error: '画面検証版です。実サービスは接続していません。', code: 'PREVIEW_ONLY' }, 503));
    const vendor: Record<string, string> = { 'vue.global.prod.js': 'text/javascript', 'tw.css': 'text/css' };
    app.get('/vendor/:file', async (c) => {
      const file = c.req.param('file');
      if (!Object.hasOwn(vendor, file)) return c.notFound();
      c.header('Content-Type', vendor[file]);
      c.header('X-Content-Type-Options', 'nosniff');
      return c.body(await readFile(new URL(`../docs/vendor/${file}`, import.meta.url)));
    });
  } else {
    // 未指定時にデモ経営数値を出さない。既存の開発モードは明示時だけ維持。
    process.env.LCC_COMMAND_MODE ??= 'production';
    ({ app } = await import('./server.js'));
  }
  mountDiosShell(app, mode);
  return app;
}

if (isMainModule(import.meta.url)) {
  const mode = selectRuntime(process.env);
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const app = await createDiosApp(mode);
  const server = serve({ fetch: app.fetch, port, hostname: process.env.K_SERVICE ? '0.0.0.0' : (process.env.HOST ?? '127.0.0.1') });
  console.log(`DIOS ${mode}: port ${port} /dios (production readiness not verified)`);
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 9000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
