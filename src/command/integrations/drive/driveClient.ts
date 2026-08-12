/**
 * Google Drive READ ONLY connector（REAL USE 75% SPRINT）。
 *
 * - 使用APIは files.list / files.get（GET）のみ。書き込み・削除・共有変更APIは呼ばない。
 * - スコープは drive.metadata.readonly 固定（内容ダウンロードもしない。検索と資料への導線のみ）。
 * - 資格情報は既存のService Account（GOOGLE_SERVICE_ACCOUNT_JSON / _FILE）を流用する。
 *   SAへ共有されたファイル/フォルダだけが見える（最小権限方式）。
 * - Drive API未有効化（403 PERMISSION_DENIED）は推測で補完せず ERROR として正直に返す。
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const DRIVE_METADATA_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

export interface DriveFileHit {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  /** ブラウザで開くための導線（根拠資料リンク） */
  webViewLink: string;
  size?: string;
  parents?: string[];
}

export type DriveConnectionState =
  | { state: 'NOT_CONNECTED'; reason: string }
  | { state: 'ERROR'; reason: string; httpStatus?: number; fix?: string }
  | { state: 'LIVE_API'; checkedAt: string; visibleFiles: number; hasMore: boolean };

interface SaCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function loadSaCredentials(env = process.env): SaCredentials | null {
  let raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw && env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    try {
      raw = readFileSync(env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8');
    } catch {
      return null;
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SaCredentials;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

export class DriveClient {
  private cachedToken: string | null = null;
  private cachedUntilMs = 0;

  constructor(
    private readonly credentials: SaCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly nowMs: () => number = Date.now
  ) {}

  static fromEnv(env = process.env, fetchImpl: typeof fetch = fetch): DriveClient | null {
    const creds = loadSaCredentials(env);
    return creds ? new DriveClient(creds, fetchImpl) : null;
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && this.nowMs() < this.cachedUntilMs) return this.cachedToken;
    const nowSec = Math.floor(this.nowMs() / 1000);
    const b64 = (s: string) => Buffer.from(s).toString('base64url');
    const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64(
      JSON.stringify({
        iss: this.credentials.client_email,
        scope: DRIVE_METADATA_READONLY_SCOPE,
        aud: this.credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
        iat: nowSec,
        exp: nowSec + 3600
      })
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const jwt = `${header}.${claims}.${signer.sign(this.credentials.private_key).toString('base64url')}`;
    const res = await this.fetchImpl(this.credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString()
    });
    if (!res.ok) throw new Error(`Drive用SAトークン取得失敗: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Drive用SAトークン取得失敗: access_tokenなし');
    this.cachedToken = body.access_token;
    this.cachedUntilMs = this.nowMs() + ((body.expires_in ?? 3600) - 60) * 1000;
    return this.cachedToken;
  }

  private async listFiles(q: string, pageSize: number): Promise<{ files: DriveFileHit[]; hasMore: boolean; httpStatus: number }> {
    const token = await this.getToken();
    const params = new URLSearchParams({
      pageSize: String(pageSize),
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,parents),nextPageToken',
      q,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      orderBy: 'modifiedTime desc'
    });
    const res = await this.fetchImpl(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return { files: [], hasMore: false, httpStatus: res.status };
    const data = (await res.json()) as { files?: DriveFileHit[]; nextPageToken?: string };
    return { files: data.files ?? [], hasMore: Boolean(data.nextPageToken), httpStatus: res.status };
  }

  /** 接続状態の実測判定。環境変数が存在するだけではLIVE_APIにしない（実取得成功が条件） */
  async checkConnection(): Promise<DriveConnectionState> {
    try {
      const { files, hasMore, httpStatus } = await this.listFiles('trashed=false', 100);
      if (httpStatus === 403) {
        return {
          state: 'ERROR',
          httpStatus,
          reason: 'Drive APIがGCPプロジェクトで未有効化（PERMISSION_DENIED）',
          fix: 'https://console.developers.google.com/apis/api/drive.googleapis.com/overview で有効化後、npm run sync:drive を再実行'
        };
      }
      if (httpStatus !== 200) return { state: 'ERROR', httpStatus, reason: `Drive API HTTP ${httpStatus}` };
      return { state: 'LIVE_API', checkedAt: new Date().toISOString(), visibleFiles: files.length, hasMore };
    } catch (e) {
      return { state: 'ERROR', reason: e instanceof Error ? e.message : String(e) };
    }
  }

  /** ファイル名検索（READ ONLY・SAへ共有された範囲のみ）。導線用webViewLinkを返す */
  async searchByName(keyword: string, limit = 20): Promise<DriveFileHit[]> {
    const escaped = keyword.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const { files, httpStatus } = await this.listFiles(`trashed=false and name contains '${escaped}'`, Math.min(limit, 100));
    if (httpStatus !== 200) throw new Error(`Drive検索に失敗しました（HTTP ${httpStatus}）`);
    return files;
  }
}
