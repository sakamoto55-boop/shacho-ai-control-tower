import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createDiosApp, selectRuntime } from '../../src/dios.js';
import { brandDiosHtml, mountDiosShell, runtimeInfo } from '../../src/dios/runtime.js';
import { readFileSync } from 'node:fs';

describe('DIOS runtime: 既存機能の継承と正直な稼働表示', () => {
  it('Cloud Runでローカル保存を本番扱いしない', () => {
    expect(() => selectRuntime({ K_SERVICE: 'test' })).toThrow('DIOS_STORAGE_GATE');
    expect(selectRuntime({ K_SERVICE: 'test', DIOS_RUNTIME_MODE: 'preview' })).toBe('preview');
  });
  it('未知のruntime値は停止する', () => {
    expect(() => selectRuntime({ DIOS_RUNTIME_MODE: 'prod' })).toThrow();
  });
  it('設定や秘密情報から接続済み状態を捏造しない', () => {
    expect(runtimeInfo('local').productionReady).toBe(false);
    expect(runtimeInfo('preview').dataConnection).toBe('NOT_CONNECTED');
  });
  it('既存VUIのCORE・認証・APIを変更せずDIOSの名称で配信', () => {
    const original = readFileSync('docs/lcc-command-vui.html', 'utf8');
    const branded = brandDiosHtml(original, 'preview');
    expect(branded).toContain('/command/chat');
    expect(branded).toContain('/command/pair/claim');
    expect(branded).toContain('const CORE_CLUSTER');
    expect(branded).toContain('画面検証版');
    expect(branded).not.toContain('LCC COMMAND');
    expect(branded).toContain('prefers-reduced-motion');
  });
  it('iPhone/PC共通起動URL・manifest・安全な応答ヘッダ', async () => {
    const app = new Hono(); mountDiosShell(app, 'local');
    const res = await app.request('/dios');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    const manifest = await (await app.request('/dios/manifest.webmanifest')).json();
    expect(manifest.start_url).toBe('/dios');
    expect(manifest.scope).toBe('/dios');
  });
  it('previewでは業務APIを読む/書くいずれの要求も実行しない', async () => {
    const app = await createDiosApp('preview');
    for (const method of ['GET', 'POST']) {
      const res = await app.request('/command/chat', { method });
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe('PREVIEW_ONLY');
    }
    expect((await app.request('/jobs/report/morning', { method: 'POST' })).status).toBe(404);
  });
  it('未取得の追跡数・完了数を0と表示せず、更新時も未確認へ戻す', () => {
    const original = readFileSync('docs/lcc-command-vui.html', 'utf8');
    for (const marker of ['{{ tracking.trackingCount }}', '{{ tracking.completedTodayCount }}', 'async loadDecisions(){', 'tracking: { trackingCount: 0, completedTodayCount: 0,']) expect(original).toContain(marker);
    const branded = brandDiosHtml(original, 'preview');
    expect(branded).toContain("decisions.loaded ? (tracking.trackingCount ?? '—') : '—'");
    expect(branded).toContain("decisions.loaded ? (tracking.completedTodayCount ?? '—') : '—'");
    expect(branded).toContain('async loadDecisions(){ this.tracking = { trackingCount: null, completedTodayCount: null };');
  });
  it('Service WorkerはAPI・秘密情報を保存しない', async () => {
    const app = await createDiosApp('preview');
    const sw = await (await app.request('/dios/sw.js')).text();
    expect(sw).toContain("cache.add('/dios/offline')");
    expect(sw).not.toContain('cache.put');
    expect(sw).toContain("event.request.mode !== 'navigate'");
    expect(sw).toContain("['/dios', '/dios/']");
    expect((await app.request('/dios/../../.env')).status).toBe(404);
  });
});
