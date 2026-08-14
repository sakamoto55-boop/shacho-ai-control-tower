/**
 * Google Service Account JWT認証（汎用scope版）。
 * driveClientの実績パターンを共通化（資格情報はenvのみ・値をログへ出さない）。
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface SaCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id?: string;
}

export function loadSaCredentials(env = process.env): SaCredentials | null {
  let raw = env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';
  if (!raw && env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    try { raw = readFileSync(env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8'); } catch { return null; }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SaCredentials;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch { return null; }
}

export class GoogleSaTokenSource {
  private cachedToken: string | null = null;
  private cachedUntilMs = 0;

  constructor(
    private readonly credentials: SaCredentials,
    private readonly scope: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly nowMs: () => number = Date.now
  ) {}

  get projectId(): string | null { return this.credentials.project_id ?? null; }

  async getToken(): Promise<string> {
    if (this.cachedToken && this.nowMs() < this.cachedUntilMs) return this.cachedToken;
    const nowSec = Math.floor(this.nowMs() / 1000);
    const b64 = (s: string) => Buffer.from(s).toString('base64url');
    const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64(JSON.stringify({
      iss: this.credentials.client_email,
      scope: this.scope,
      aud: this.credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const jwt = `${header}.${claims}.${signer.sign(this.credentials.private_key).toString('base64url')}`;
    const res = await this.fetchImpl(this.credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString()
    });
    if (!res.ok) throw new Error(`SAトークン取得失敗: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('SAトークン取得失敗: access_tokenなし');
    this.cachedToken = body.access_token;
    this.cachedUntilMs = this.nowMs() + ((body.expires_in ?? 3600) - 60) * 1000;
    return this.cachedToken;
  }
}
