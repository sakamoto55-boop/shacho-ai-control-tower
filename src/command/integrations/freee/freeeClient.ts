/**
 * freee人事労務（勤怠）read-only connector（夜間統合運転 §11）。
 *
 * - OAuth 2.0 Authorization Code Flow（localhost callback）。
 * - tokenは secure/freee-tokens.json（Git外・.gitignoreのsecure/配下）へ保存。
 * - 許可HTTP: GET + token交換POSTのみ。書き込みAPIは呼ばない。
 * - 秘密情報（token・Client Secret）はログ・例外メッセージへ出さない。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TOKEN_ENDPOINT = 'https://accounts.secure.freee.co.jp/public_api/token';
const AUTHORIZE_ENDPOINT = 'https://accounts.secure.freee.co.jp/public_api/authorize';
const HR_API_BASE = 'https://api.freee.co.jp/hr/api/v1';

export interface FreeeTokens {
  accessToken: string;
  refreshToken: string;
  /** epoch millis */
  expiresAt: number;
  scope: string;
}

export interface FreeeConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string;
  tokenFile: string;
}

export function loadFreeeConfig(rootDir = '.'): FreeeConfig {
  return {
    clientId: process.env.FREEE_CLIENT_ID,
    clientSecret: process.env.FREEE_CLIENT_SECRET,
    redirectUri: process.env.FREEE_REDIRECT_URI ?? 'http://127.0.0.1:8790/freee/callback',
    tokenFile: join(rootDir, 'secure', 'freee-tokens.json')
  };
}

export type FreeeAuthState =
  | { state: 'ADMIN_SETUP_REQUIRED'; reason: string }
  | { state: 'AUTH_REQUIRED'; authorizeUrl: string }
  | { state: 'READY'; tokens: FreeeTokens };

export function buildAuthorizeUrl(config: FreeeConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId ?? '',
    redirect_uri: config.redirectUri,
    response_type: 'code',
    prompt: 'select_company'
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export function loadTokens(config: FreeeConfig): FreeeTokens | null {
  if (!existsSync(config.tokenFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(config.tokenFile, 'utf8')) as FreeeTokens;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveTokens(config: FreeeConfig, tokens: FreeeTokens): void {
  mkdirSync(dirname(config.tokenFile), { recursive: true });
  writeFileSync(config.tokenFile, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: 'utf8' });
}

/** 認証状態を判定する（tokenがなければ認可URLを返す。値はログへ出さない） */
export function resolveAuthState(config: FreeeConfig): FreeeAuthState {
  if (!config.clientId || !config.clientSecret) {
    return {
      state: 'ADMIN_SETUP_REQUIRED',
      reason: 'freeeアプリ未登録（FREEE_CLIENT_ID / FREEE_CLIENT_SECRET が.envに未設定）'
    };
  }
  const tokens = loadTokens(config);
  if (!tokens) {
    return { state: 'AUTH_REQUIRED', authorizeUrl: buildAuthorizeUrl(config) };
  }
  return { state: 'READY', tokens };
}

interface FetchLike {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    json(): Promise<unknown>;
  }>;
}

export class FreeeClient {
  private tokens: FreeeTokens | null;

  constructor(
    private readonly config: FreeeConfig,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now
  ) {
    this.tokens = loadTokens(config);
  }

  /** 認可コードをtokenへ交換する（OAuthに必要なPOST。これ以外のPOSTは行わない） */
  async exchangeCode(code: string): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId ?? '',
      client_secret: this.config.clientSecret ?? '',
      code,
      redirect_uri: this.config.redirectUri
    });
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) throw new Error(`freee token交換に失敗しました（HTTP ${res.status}）`);
    this.applyTokenResponse((await res.json()) as Record<string, unknown>);
  }

  private applyTokenResponse(data: Record<string, unknown>): void {
    const tokens: FreeeTokens = {
      accessToken: String(data.access_token ?? ''),
      refreshToken: String(data.refresh_token ?? ''),
      expiresAt: this.now() + Number(data.expires_in ?? 0) * 1000,
      scope: String(data.scope ?? '')
    };
    if (!tokens.accessToken) throw new Error('freee tokenレスポンスが不正です');
    this.tokens = tokens;
    saveTokens(this.config, tokens);
  }

  private async refreshIfNeeded(): Promise<void> {
    if (!this.tokens) throw new Error('freee未認証です（AUTH_REQUIRED）');
    if (this.tokens.expiresAt - this.now() > 60_000) return;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId ?? '',
      client_secret: this.config.clientSecret ?? '',
      refresh_token: this.tokens.refreshToken
    });
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) throw new Error(`freee tokenリフレッシュに失敗しました（HTTP ${res.status}）`);
    this.applyTokenResponse((await res.json()) as Record<string, unknown>);
  }

  /** GET専用。429/5xxは指数バックオフで最大3回再試行 */
  async get<T>(path: string): Promise<T> {
    await this.refreshIfNeeded();
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.fetchImpl(`${HR_API_BASE}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.tokens?.accessToken ?? ''}` }
      });
      if (res.ok) return (await res.json()) as T;
      lastStatus = res.status;
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
    throw new Error(`freee API GET ${path} に失敗しました（HTTP ${lastStatus}）`);
  }

  async listCompanies(): Promise<Array<{ id: number; name: string }>> {
    // 人事労務APIの事業所一覧は /users/me が正（/companies は存在しない=404）
    const data = await this.get<{ companies?: Array<{ id: number; name: string }> }>('/users/me');
    return data.companies ?? [];
  }

  async listEmployees(companyId: number, limit = 50): Promise<Array<Record<string, unknown>>> {
    const data = await this.get<{ employees?: Array<Record<string, unknown>> }>(
      `/companies/${companyId}/employees?limit=${limit}`
    );
    return data.employees ?? [];
  }

  async getTimeClocks(companyId: number, employeeId: number, fromDate: string, toDate: string) {
    // freee既定limit(50)による切り詰め防止: limit=100でoffsetページングし全件回収
    const all: Array<Record<string, unknown>> = [];
    const limit = 100;
    for (let offset = 0; offset < 10_000; offset += limit) {
      const page = await this.get<Array<Record<string, unknown>>>(
        `/employees/${employeeId}/time_clocks?company_id=${companyId}&from_date=${fromDate}&to_date=${toDate}&limit=${limit}&offset=${offset}`
      );
      all.push(...page);
      if (page.length < limit) break;
    }
    return all;
  }
}
