import { createSign } from 'node:crypto';

// LINE WORKS API 2.0 クライアント（Service Account認証 + Bot メッセージ送信）
// 参考: https://developers.worksmobile.com/jp/docs/auth-jwt
//       https://developers.worksmobile.com/jp/docs/bot-user-message-send

const TOKEN_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token';
const API_BASE = 'https://www.worksapis.com/v1.0';

export interface LineworksApiConfig {
  clientId: string;
  clientSecret: string;
  serviceAccount: string;
  privateKey: string;
  botId: string;
}

export interface LineworksRecipient {
  /** 宛先の表示名（例: 竹内、平良）。MCPツールはこの名前で宛先を指定する */
  name: string;
  /** user: 1対1トーク（userIdまたはLINE WORKSアカウントID）、channel: トークルーム */
  type: 'user' | 'channel';
  id: string;
}

function base64url(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Service Account認証用のJWT（RS256）を生成する */
export function buildServiceAccountJwt(config: LineworksApiConfig, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: config.clientId,
      sub: config.serviceAccount,
      iat: nowSeconds,
      exp: nowSeconds + 3600
    })
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  // .envでは改行を \n で書くため、実際の改行に戻す
  const privateKey = config.privateKey.replace(/\\n/g, '\n');
  const signature = base64url(signer.sign(privateKey));
  return `${header}.${payload}.${signature}`;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export class LineworksApiClient {
  private tokenCache: TokenCache | null = null;

  constructor(private readonly config: LineworksApiConfig) {}

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.accessToken;
    }

    const assertion = buildServiceAccountJwt(this.config);
    const body = new URLSearchParams({
      assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'bot'
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`LINE WORKSトークン取得に失敗しました (${response.status}): ${detail}`);
    }

    const json = (await response.json()) as { access_token: string; expires_in?: number | string };
    const expiresInSeconds = Number(json.expires_in ?? 3600);
    this.tokenCache = {
      accessToken: json.access_token,
      expiresAt: now + expiresInSeconds * 1000
    };
    return json.access_token;
  }

  /** 指定した宛先（ユーザーまたはトークルーム）へテキストメッセージを送信する */
  async sendTextMessage(recipient: LineworksRecipient, text: string): Promise<void> {
    const accessToken = await this.getAccessToken();
    const path =
      recipient.type === 'channel'
        ? `/bots/${this.config.botId}/channels/${encodeURIComponent(recipient.id)}/messages`
        : `/bots/${this.config.botId}/users/${encodeURIComponent(recipient.id)}/messages`;

    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content: { type: 'text', text } })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`LINE WORKSメッセージ送信に失敗しました (${response.status}): ${detail}`);
    }
  }
}

export function loadLineworksApiConfigFromEnv(env = process.env): LineworksApiConfig | null {
  const clientId = env.LINEWORKS_CLIENT_ID ?? '';
  const clientSecret = env.LINEWORKS_CLIENT_SECRET ?? '';
  const serviceAccount = env.LINEWORKS_SERVICE_ACCOUNT ?? '';
  const privateKey = env.LINEWORKS_PRIVATE_KEY ?? '';
  const botId = env.LINEWORKS_BOT_ID ?? '';
  if (!clientId || !clientSecret || !serviceAccount || !privateKey || !botId) {
    return null;
  }
  return { clientId, clientSecret, serviceAccount, privateKey, botId };
}

/**
 * 送信可能な宛先リストを LINEWORKS_RECIPIENTS（JSON配列）から読み込む。
 * 例: [{"name":"竹内","type":"user","id":"k.takeuchi@example.com"}]
 * ここに載っていない宛先へは送信できない（誤送信防止のための許可リスト）。
 */
export function loadRecipientsFromEnv(env = process.env): LineworksRecipient[] {
  const raw = env.LINEWORKS_RECIPIENTS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LineworksRecipient =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as LineworksRecipient).name === 'string' &&
        ((item as LineworksRecipient).type === 'user' || (item as LineworksRecipient).type === 'channel') &&
        typeof (item as LineworksRecipient).id === 'string'
    );
  } catch {
    return [];
  }
}

export function isDryRun(env = process.env): boolean {
  return env.LINEWORKS_DRY_RUN !== 'false';
}
