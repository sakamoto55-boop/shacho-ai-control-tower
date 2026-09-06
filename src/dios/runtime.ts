/** DIOS起動口。既存COMMANDを再実装せず、同じAPI・権限・Memoryへ接続する。 */
import { readFile } from 'node:fs/promises';
import type { Hono } from 'hono';

export type DiosRuntimeMode = 'local' | 'preview';
export interface DiosRuntimeInfo {
  product: 'DIOS';
  mode: DiosRuntimeMode;
  productionReady: false;
  dataConnection: 'NOT_CONNECTED' | 'AUTHENTICATED_API_REQUIRED';
  releaseGate: 'NOT_EVALUATED';
}

export function runtimeInfo(mode: DiosRuntimeMode): DiosRuntimeInfo {
  return {
    product: 'DIOS', mode, productionReady: false,
    dataConnection: mode === 'preview' ? 'NOT_CONNECTED' : 'AUTHENTICATED_API_REQUIRED',
    releaseGate: 'NOT_EVALUATED'
  };
}

const headers: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store'
};

export function brandDiosHtml(html: string, mode: DiosRuntimeMode): string {
  const notice = mode === 'preview'
    ? '画面検証版：会社データ・AI・外部サービスは未接続です。'
    : '実装検証版：本番未検収。接続状態は「データ接続」で確認してください。';
  return html.replaceAll('LCC COMMAND', 'DIOS')
    // 接続不明と0件を分離。取得のたびに未確認へ戻して旧成功値も残さない。
    .replace('tracking: { trackingCount: 0, completedTodayCount: 0,', 'tracking: { trackingCount: null, completedTodayCount: null,')
    .replace('async loadDecisions(){', 'async loadDecisions(){ this.tracking = { trackingCount: null, completedTodayCount: null };')
    .replace('{{ tracking.trackingCount }}', "{{ decisions.loaded ? (tracking.trackingCount ?? '—') : '—' }}")
    .replace('{{ tracking.completedTodayCount }}', "{{ decisions.loaded ? (tracking.completedTodayCount ?? '—') : '—' }}")
    .replace('__LCC_BUILD_BRANCH__', 'unknown')
    .replace('__LCC_BUILD_COMMIT__', 'unknown')
    .replace('__LCC_SERVED_AT__', '本番検収前')
    .replace('</head>', '<link rel="manifest" href="/dios/manifest.webmanifest"><link rel="icon" href="/dios/icon.svg"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#07111f"></head>')
    .replace('<body', '<body data-dios-runtime="' + mode + '"')
    .replace('</body>', `<aside id="dios-release-notice" style="position:fixed;bottom:calc(74px + env(safe-area-inset-bottom));left:10px;right:10px;z-index:100;pointer-events:none;text-align:center;font:11px sans-serif;color:#e6edf3;background:#132032e6;padding:5px;border-radius:8px" role="status">${notice}</aside><script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/dios/sw.js',{scope:'/dios'}).catch(function(){document.getElementById('dios-release-notice').textContent+=' ホーム画面機能の準備は未完了です。';});}</script></body>`);
}

/** 静的ファイルは明示したものだけ。APIや会話はService Workerへ保存しない。 */
export function mountDiosShell(app: Hono, mode: DiosRuntimeMode): void {
  for (const path of ['/dios', '/dios/*']) {
    app.use(path, async (c, next) => {
      for (const [k, v] of Object.entries(headers)) c.header(k, v);
      await next();
    });
  }
  app.get('/', (c) => c.redirect('/dios', 302));
  app.get('/dios/', (c) => c.redirect('/dios', 302));
  app.get('/dios', async (c) => {
    const html = await readFile(new URL('../../docs/lcc-command-vui.html', import.meta.url), 'utf8');
    return c.html(brandDiosHtml(html, mode));
  });
  app.get('/dios/runtime.json', (c) => c.json(runtimeInfo(mode)));
  app.get('/dios/manifest.webmanifest', (c) => {
    c.header('Content-Type', 'application/manifest+json');
    return c.body(JSON.stringify({
      id: '/dios', name: 'DIOS — Digital Intelligence Operating System', short_name: 'DIOS',
      start_url: '/dios', scope: '/dios', display: 'standalone', lang: 'ja',
      background_color: '#07111f', theme_color: '#07111f',
      icons: [{ src: '/dios/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
    }));
  });
  app.get('/dios/icon.svg', (c) => {
    c.header('Content-Type', 'image/svg+xml');
    return c.body('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" rx="40" fill="#07111f"/><circle cx="96" cy="96" r="56" fill="none" stroke="#70adfa" stroke-width="3" stroke-dasharray="1 6"/><circle cx="96" cy="96" r="42" fill="none" stroke="#a28cff" stroke-width="2" stroke-dasharray="1 5"/><text x="96" y="103" text-anchor="middle" font-size="22" font-family="sans-serif" fill="white">DIOS</text></svg>');
  });
  app.get('/dios/offline', (c) => c.html('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DIOS 接続待ち</title><body style="background:#07111f;color:#edf5fb;font:16px sans-serif;padding:32px"><h1>DIOS</h1><p>通信が切れています。会話や会社データは端末に保存していません。</p><p>ネットワーク接続後に再読み込みしてください。</p><a style="color:#70adfa" href="/dios">再接続</a></body></html>'));
  app.get('/dios/sw.js', async (c) => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    c.header('Service-Worker-Allowed', '/dios');
    return c.body(await readFile(new URL('../../docs/dios/sw.js', import.meta.url), 'utf8'));
  });
}
