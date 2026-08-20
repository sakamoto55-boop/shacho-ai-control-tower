import { describe, expect, it, vi } from 'vitest';
import { downloadDriveFile, loadKeiriCash } from '../../src/command/sources/keiriCash.js';
import { ServiceAccountTokenProvider } from '../../src/command/sources/googleSheets.js';

function fakeProvider(): ServiceAccountTokenProvider {
  const p = Object.create(ServiceAccountTokenProvider.prototype) as ServiceAccountTokenProvider;
  (p as unknown as { getToken: () => Promise<string> }).getToken = async () => 'TESTTOKEN';
  return p;
}

describe('資金繰表 Drive取得（SA・drive.readonly）', () => {
  it('downloadDriveFile: alt=media・Bearerトークンで叩き、bufferを返す', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/drive/v3/files/');
      expect(url).toContain('alt=media');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer TESTTOKEN');
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer } as unknown as Response;
    });
    const buf = await downloadDriveFile('FILE123', fakeProvider(), fetchImpl as unknown as typeof fetch);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(4);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('downloadDriveFile: 404はSA共有未設定の示唆付きで例外', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response);
    await expect(downloadDriveFile('X', fakeProvider(), fetchImpl as unknown as typeof fetch)).rejects.toThrow(/404.*共有/);
  });

  it('loadKeiriCash: SA未設定なら available:false（例外にしない）', async () => {
    const r = await loadKeiriCash('2026-08-20T00:00:00Z', {} as NodeJS.ProcessEnv);
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toMatch(/サービスアカウント未設定/);
  });

  it('loadKeiriCash: ダウンロード失敗は available:false + reason', async () => {
    const env = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'x' }) } as unknown as NodeJS.ProcessEnv;
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response);
    const r = await loadKeiriCash('2026-08-20T00:00:00Z', env, fetchImpl as unknown as typeof fetch);
    expect(r.available).toBe(false);
  });
});
