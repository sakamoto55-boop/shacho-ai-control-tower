/** 実サービスへ接続せず、コンパイル後のHTTP起動・安全停止を検証する。 */
/* global process, console, fetch, setTimeout, clearTimeout, AbortSignal */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
const entry = resolve('dist/dios.js');
const temp = await mkdtemp(join(tmpdir(), 'dios-http-'));

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1');
  await once(server, 'listening'); const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function check(mode) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { PATH: process.env.PATH, HOME: temp, TMPDIR: temp, SystemRoot: process.env.SystemRoot,
    NODE_ENV: 'production', AI_PROVIDER: 'mock', DIOS_RUNTIME_MODE: mode,
    LCC_COMMAND_MODE: 'production', LCC_COMMAND_API_TOKENS: '{}', ENABLE_DEV_ENDPOINTS: 'false',
    PORT: String(port), HOST: '127.0.0.1' };
  const child = spawn(process.execPath, [entry], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = ''; child.stdout.on('data', (x) => { diagnostics = (diagnostics + x).slice(-3000); });
  child.stderr.on('data', (x) => { diagnostics = (diagnostics + x).slice(-3000); });
  const exited = once(child, 'exit');
  try {
    const deadline = Date.now() + 15000; let ready = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try { ready = (await fetch(base + '/health', { signal: AbortSignal.timeout(800) })).ok; } catch { /* 起動待ち */ }
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(ready, `startup failed (${mode}): ${diagnostics}`);
    const page = await fetch(base + '/dios'); assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store'); assert.match(await page.text(), /DIOS/);
    const manifest = await (await fetch(base + '/dios/manifest.webmanifest')).json(); assert.equal(manifest.start_url, '/dios');
    const blocked = await fetch(base + '/command/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"smoke"}' });
    assert.equal(blocked.status, mode === 'preview' ? 503 : 401);
    const job = await fetch(base + '/jobs/report/morning', { method: 'POST' }); assert.equal(job.status, mode === 'preview' ? 404 : 401);
    const status = await (await fetch(base + '/dios/runtime.json')).json(); assert.equal(status.productionReady, false);
    console.log(`PASS ${mode}: HTTP /dios, manifest, no-store, unauthorized writes denied, honest readiness`);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    await exited; clearTimeout(timer);
  }
}
try { await check('preview'); await check('local'); } finally { await rm(temp, { recursive: true, force: true }); }
