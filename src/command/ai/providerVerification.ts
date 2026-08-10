/**
 * Provider実疎通検証（是正⑦ 修正1）。
 *
 * キーの存在だけでACTIVE/READYと表示しない。実APIの最小疎通に成功した場合のみACTIVE。
 * 失敗は 401/403=AUTH_FAILED、429=RATE_LIMITED、timeout/5xx=TEMPORARILY_UNAVAILABLE に区別する。
 * APIキーの値・先頭・末尾を応答やログへ出さない。
 */

export type VerifiedProviderStatus =
  | 'NOT_CONFIGURED'
  | 'CONFIGURED_UNVERIFIED'
  | 'ACTIVE'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'DISABLED';

export interface ProviderProbeResult {
  providerId: string;
  status: VerifiedProviderStatus;
  /** HTTPステータス（判定根拠。キー情報は含まない） */
  httpStatus?: number;
  checkedAt: string;
  retryable: boolean;
}

/** 実APIへの最小疎通。テストではfake実装を注入する */
export type ProviderProber = (providerId: string) => Promise<ProviderProbeResult>;

export function mapHttpStatus(providerId: string, httpStatus: number, checkedAt: string): ProviderProbeResult {
  if (httpStatus >= 200 && httpStatus < 300) {
    return { providerId, status: 'ACTIVE', httpStatus, checkedAt, retryable: false };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { providerId, status: 'AUTH_FAILED', httpStatus, checkedAt, retryable: false };
  }
  if (httpStatus === 429) {
    return { providerId, status: 'RATE_LIMITED', httpStatus, checkedAt, retryable: true };
  }
  return { providerId, status: 'TEMPORARILY_UNAVAILABLE', httpStatus, checkedAt, retryable: true };
}

/** fetchベースの既定Prober。キー未設定Providerは呼ばれない前提（呼ばれたらNOT_CONFIGURED） */
export function createDefaultProber(env = process.env): ProviderProber {
  return async (providerId: string): Promise<ProviderProbeResult> => {
    const checkedAt = new Date().toISOString();
    try {
      if (providerId === 'anthropic') {
        if (!env.ANTHROPIC_API_KEY) {
          return { providerId, status: 'NOT_CONFIGURED', checkedAt, retryable: false };
        }
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: env.LCC_COMMAND_MODEL ?? 'claude-sonnet-5',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }]
          }),
          signal: AbortSignal.timeout(15000)
        });
        return mapHttpStatus(providerId, res.status, checkedAt);
      }
      if (providerId === 'openai') {
        if (!env.OPENAI_API_KEY) {
          return { providerId, status: 'NOT_CONFIGURED', checkedAt, retryable: false };
        }
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
          signal: AbortSignal.timeout(15000)
        });
        return mapHttpStatus(providerId, res.status, checkedAt);
      }
      if (providerId === 'gemini') {
        if (!env.GEMINI_API_KEY) {
          return { providerId, status: 'NOT_CONFIGURED', checkedAt, retryable: false };
        }
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
          headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
          signal: AbortSignal.timeout(15000)
        });
        return mapHttpStatus(providerId, res.status, checkedAt);
      }
      // 疎通手段未実装のProvider（manus等）はキー存在=未検証のまま
      return { providerId, status: 'CONFIGURED_UNVERIFIED', checkedAt, retryable: false };
    } catch {
      // timeout・DNS失敗等（例外メッセージはキーを含む可能性があるため記録しない）
      return { providerId, status: 'TEMPORARILY_UNAVAILABLE', checkedAt, retryable: true };
    }
  };
}

interface CacheEntry {
  result: ProviderProbeResult;
  expiresAt: number;
}

/**
 * 疎通結果の短時間キャッシュ付きサービス。
 * 成功は5分、失敗は60秒キャッシュし、/providers参照のたびに外部APIを叩き続けない。
 */
export class ProviderVerificationService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prober: ProviderProber,
    private readonly hasKey: (providerId: string) => boolean,
    private readonly ttl = { successMs: 5 * 60_000, failureMs: 60_000 }
  ) {}

  /** キー未設定は疎通せずNOT_CONFIGURED。キー有りは疎通結果（キャッシュ有効期間内は再利用） */
  async getStatus(providerId: string, now = Date.now()): Promise<ProviderProbeResult> {
    if (!this.hasKey(providerId)) {
      return {
        providerId,
        status: 'NOT_CONFIGURED',
        checkedAt: new Date(now).toISOString(),
        retryable: false
      };
    }
    const cached = this.cache.get(providerId);
    if (cached && cached.expiresAt > now) return cached.result;
    const result = await this.prober(providerId);
    const ttl = result.status === 'ACTIVE' ? this.ttl.successMs : this.ttl.failureMs;
    this.cache.set(providerId, { result, expiresAt: now + ttl });
    return result;
  }

  /** 検証前の表示用状態（疎通を伴わない）。キー有り=CONFIGURED_UNVERIFIED */
  unverifiedStatus(providerId: string): VerifiedProviderStatus {
    return this.hasKey(providerId) ? 'CONFIGURED_UNVERIFIED' : 'NOT_CONFIGURED';
  }

  invalidate(providerId?: string): void {
    if (providerId) this.cache.delete(providerId);
    else this.cache.clear();
  }
}

/** 会話系の内部reasonCode（是正⑦ 修正2） */
export type AiReasonCode =
  | 'AI_AUTH_FAILED'
  | 'AI_RATE_LIMITED'
  | 'AI_TEMPORARILY_UNAVAILABLE'
  | 'AI_NOT_CONFIGURED';

/** Provider例外（SDKのstatus付きエラー等）をreasonCodeへ分類する。キー情報は扱わない */
export function classifyProviderError(error: unknown): AiReasonCode {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 401 || status === 403) return 'AI_AUTH_FAILED';
  if (status === 429) return 'AI_RATE_LIMITED';
  return 'AI_TEMPORARILY_UNAVAILABLE';
}
