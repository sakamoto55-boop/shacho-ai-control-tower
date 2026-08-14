/**
 * Gmail READ ONLYクライアント（構成訂正§1）。
 *
 * - OAuthは gmail.readonly のみ（送信権限を付与しない）。freeeClientと同じloopback認可パターン。
 * - users.watch はINBOX対象・Pub/Sub topicへ通知（topicはenv GMAIL_PUBSUB_TOPIC）。
 * - 未認証はCONFIG_REQUIREDとして正直に返す（実行したふりをしない）。
 * - tokenは環境変数指定の単一ファイル（Git外・値をログへ出さない）。保存はtemp+rename原子化。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export interface GmailConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string;
  tokenFile: string;
  pubsubTopic: string | undefined; // projects/<p>/topics/<t>
}

export function loadGmailConfig(rootDir = '.'): GmailConfig {
  return {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI ?? 'http://127.0.0.1:8794/gmail/callback',
    tokenFile: process.env.GMAIL_TOKEN_FILE ?? join(rootDir, 'secure', 'gmail-tokens.json'),
    pubsubTopic: process.env.GMAIL_PUBSUB_TOPIC
  };
}

export type GmailAuthState =
  | { state: 'CONFIG_REQUIRED'; reason: string }
  | { state: 'AUTH_REQUIRED'; authorizeUrl: string }
  | { state: 'READY' };

/** oauthState: CSRF対策のstateパラメータ（認可ヘルパーが生成しcallbackで検証する） */
export function resolveGmailAuthState(config = loadGmailConfig(), oauthState?: string): GmailAuthState {
  if (!config.clientId || !config.clientSecret) {
    return { state: 'CONFIG_REQUIRED', reason: 'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET が未設定（GCPでOAuthクライアント作成が必要）' };
  }
  if (!config.pubsubTopic) {
    return { state: 'CONFIG_REQUIRED', reason: 'GMAIL_PUBSUB_TOPIC が未設定（Pub/Sub topic作成が必要）' };
  }
  if (!existsSync(config.tokenFile)) {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: GMAIL_READONLY_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      ...(oauthState ? { state: oauthState } : {})
    });
    return { state: 'AUTH_REQUIRED', authorizeUrl: `${AUTHORIZE_ENDPOINT}?${params.toString()}` };
  }
  return { state: 'READY' };
}

function saveTokens(config: GmailConfig, tokens: GmailTokens): void {
  mkdirSync(dirname(config.tokenFile), { recursive: true });
  const tmp = `${config.tokenFile}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8');
  renameSync(tmp, config.tokenFile);
}

export class GmailClient {
  private tokens: GmailTokens | null = null;

  constructor(
    private readonly config: GmailConfig = loadGmailConfig(),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {
    if (existsSync(config.tokenFile)) {
      try { this.tokens = JSON.parse(readFileSync(config.tokenFile, 'utf8')) as GmailTokens; } catch { this.tokens = null; }
    }
  }

  async exchangeCode(code: string): Promise<void> {
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.config.clientId ?? '',
        client_secret: this.config.clientSecret ?? '',
        code,
        redirect_uri: this.config.redirectUri
      }).toString()
    });
    if (!res.ok) throw new Error(`Gmail token交換失敗（HTTP ${res.status}）`);
    this.applyTokens((await res.json()) as Record<string, unknown>);
  }

  private applyTokens(data: Record<string, unknown>): void {
    const tokens: GmailTokens = {
      accessToken: String(data.access_token ?? ''),
      refreshToken: String(data.refresh_token ?? this.tokens?.refreshToken ?? ''),
      expiresAt: this.now() + Number(data.expires_in ?? 0) * 1000,
      scope: String(data.scope ?? GMAIL_READONLY_SCOPE)
    };
    if (!tokens.accessToken) throw new Error('Gmail tokenレスポンス不正');
    this.tokens = tokens;
    saveTokens(this.config, tokens);
  }

  private async refreshIfNeeded(): Promise<void> {
    if (!this.tokens) throw new Error('Gmail未認証（AUTH_REQUIRED）');
    if (this.tokens.expiresAt - this.now() > 60_000) return;
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.config.clientId ?? '',
        client_secret: this.config.clientSecret ?? '',
        refresh_token: this.tokens.refreshToken
      }).toString()
    });
    if (!res.ok) throw new Error(`Gmail tokenリフレッシュ失敗（HTTP ${res.status}）`);
    this.applyTokens((await res.json()) as Record<string, unknown>);
  }

  private async get<T>(path: string): Promise<T> {
    await this.refreshIfNeeded();
    const res = await this.fetchImpl(`${GMAIL_BASE}${path}`, {
      headers: { authorization: `Bearer ${this.tokens?.accessToken ?? ''}` }
    });
    if (!res.ok) throw new Error(`Gmail API GET ${path} 失敗（HTTP ${res.status}）`);
    return (await res.json()) as T;
  }

  /** users.watch（INBOX限定・READ ONLY操作の範囲内の必須POST）。expiration(ms epoch文字列)を返す */
  async watch(): Promise<{ historyId: string; expiration: string }> {
    await this.refreshIfNeeded();
    const res = await this.fetchImpl(`${GMAIL_BASE}/users/me/watch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.tokens?.accessToken ?? ''}` },
      body: JSON.stringify({ topicName: this.config.pubsubTopic, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' })
    });
    if (!res.ok) throw new Error(`users.watch 失敗（HTTP ${res.status}）`);
    const body = (await res.json()) as { historyId?: string; expiration?: string };
    if (!body.historyId || !body.expiration) throw new Error('users.watch レスポンス不正');
    return { historyId: body.historyId, expiration: body.expiration };
  }

  /** users.stop（watch解除・ロールバック用。tokenやメールへの影響なし） */
  async stopWatch(): Promise<void> {
    await this.refreshIfNeeded();
    const res = await this.fetchImpl(`${GMAIL_BASE}/users/me/stop`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.tokens?.accessToken ?? ''}` }
    });
    if (!res.ok) throw new Error(`users.stop 失敗（HTTP ${res.status}）`);
  }

  /**
   * history差分（startHistoryId以降のmessageAdded）。
   * nextPageTokenがなくなるまで取得する（§E: 取りこぼし防止）。
   * 安全上限（既定100ページ）に達してもnextPageTokenが残る場合はthrow＝呼出側がFETCH_FAILEDとし
   * historyIdを進めない（未取得分を失わない）。
   */
  async listHistory(startHistoryId: string, maxPages = 100): Promise<{ newMessageIds: string[]; latestHistoryId: string | null }> {
    const ids: string[] = [];
    let pageToken = '';
    let latest: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX' });
      if (pageToken) params.set('pageToken', pageToken);
      const body = await this.get<{
        history?: Array<{ id?: string; messagesAdded?: Array<{ message?: { id?: string } }> }>;
        historyId?: string;
        nextPageToken?: string;
      }>(`/users/me/history?${params.toString()}`);
      latest = body.historyId ?? latest;
      for (const h of body.history ?? []) {
        for (const m of h.messagesAdded ?? []) if (m.message?.id) ids.push(m.message.id);
      }
      if (!body.nextPageToken) return { newMessageIds: [...new Set(ids)], latestHistoryId: latest };
      pageToken = body.nextPageToken;
    }
    throw new Error(`history取得が安全上限${maxPages}ページを超過（未取得分があるためhistoryIdを進めない）`);
  }

  /** メッセージ取得（metadata: 送信者・宛先・件名・日時。本文はsnippetまで） */
  async getMessageMeta(messageId: string): Promise<{
    messageId: string; threadId: string; historyId: string;
    from: string; to: string; subject: string; date: string | null; snippet: string;
    attachments: Array<{ filename: string; mimeType: string; sizeBytes: number }>;
  }> {
    const body = await this.get<{
      id: string; threadId: string; historyId: string; snippet?: string;
      payload?: { headers?: Array<{ name: string; value: string }>; parts?: Array<{ filename?: string; mimeType?: string; body?: { size?: number } }> };
      internalDate?: string;
    }>(`/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
    const header = (name: string) => body.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
    return {
      messageId: body.id,
      threadId: body.threadId,
      historyId: body.historyId,
      from: header('From'),
      to: header('To'),
      subject: header('Subject'),
      date: body.internalDate ? new Date(Number(body.internalDate)).toISOString() : null,
      snippet: body.snippet ?? '',
      attachments: (body.payload?.parts ?? [])
        .filter((p) => p.filename)
        .map((p) => ({ filename: p.filename ?? '', mimeType: p.mimeType ?? '', sizeBytes: p.body?.size ?? 0 }))
    };
  }
}
