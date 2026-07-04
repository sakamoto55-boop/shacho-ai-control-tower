import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('/dev/* CONSOLE_ACCESS_KEY protection', () => {
  const originalKey = process.env.CONSOLE_ACCESS_KEY;
  const originalStorage = process.env.STORAGE_DRIVER;
  const originalDbPath = process.env.LOCAL_DB_PATH;

  beforeEach(() => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_DB_PATH = './data/test-console-access-key.json';
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CONSOLE_ACCESS_KEY;
    else process.env.CONSOLE_ACCESS_KEY = originalKey;
    if (originalStorage === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = originalStorage;
    if (originalDbPath === undefined) delete process.env.LOCAL_DB_PATH;
    else process.env.LOCAL_DB_PATH = originalDbPath;
  });

  it('allows /dev/console without a key when CONSOLE_ACCESS_KEY is unset', async () => {
    delete process.env.CONSOLE_ACCESS_KEY;
    const { app } = await import('../../src/server.js?no-key');
    const res = await app.request('/dev/console');
    expect(res.status).toBe(200);
  });

  it('rejects /dev/console without a key when CONSOLE_ACCESS_KEY is set', async () => {
    process.env.CONSOLE_ACCESS_KEY = 'secret123';
    const { app } = await import('../../src/server.js?with-key');
    const res = await app.request('/dev/console');
    expect(res.status).toBe(401);
  });

  it('allows /dev/console with the correct ?key= query param', async () => {
    process.env.CONSOLE_ACCESS_KEY = 'secret123';
    const { app } = await import('../../src/server.js?with-key-2');
    const res = await app.request('/dev/console?key=secret123');
    expect(res.status).toBe(200);
  });

  it('rejects /dev/analyze-text with a wrong x-console-key header', async () => {
    process.env.CONSOLE_ACCESS_KEY = 'secret123';
    const { app } = await import('../../src/server.js?with-key-3');
    const res = await app.request('/dev/analyze-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-console-key': 'wrong' },
      body: JSON.stringify({ text: 'テスト' })
    });
    expect(res.status).toBe(401);
  });

  it('rejects /jobs/fetch-messages without a key when CONSOLE_ACCESS_KEY is set', async () => {
    process.env.CONSOLE_ACCESS_KEY = 'secret123';
    const { app } = await import('../../src/server.js?with-key-4');
    const res = await app.request('/jobs/fetch-messages', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('allows /jobs/fetch-messages with the correct x-console-key header', async () => {
    process.env.CONSOLE_ACCESS_KEY = 'secret123';
    const { app } = await import('../../src/server.js?with-key-5');
    const res = await app.request('/jobs/fetch-messages', {
      method: 'POST',
      headers: { 'x-console-key': 'secret123' }
    });
    expect(res.status).toBe(200);
  });
});
