/**
 * セキュリティユーティリティ。
 * - Tool引数のValidation（未知scope・不正日付・不正金額を拒否）
 * - Prompt Injection検知（外部文書・ユーザー入力内の命令をSystem Instruction化しない）
 * - Rate Limit（メモリ内スライディングウィンドウ）
 * - Sensitive Data Masking（ログ出力用）
 */
import type { CashScenarioAdjustment, CompanyScope } from '../domain/types.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const SCOPE_PATTERN = /^[a-z0-9_-]{1,32}$/;

export function validateScope(scope: unknown): CompanyScope {
  if (scope === undefined || scope === null || scope === '') return 'group';
  if (typeof scope !== 'string' || !(scope === 'group' || SCOPE_PATTERN.test(scope))) {
    throw new ValidationError('scopeの形式が不正です');
  }
  return scope;
}

export function validateAsOf(asOf: unknown): string | undefined {
  if (asOf === undefined || asOf === null || asOf === '') return undefined;
  if (typeof asOf !== 'string' || Number.isNaN(Date.parse(asOf))) {
    throw new ValidationError('asOfはISO日時である必要があります');
  }
  return asOf;
}

export function validateMessage(message: unknown): string {
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new ValidationError('message is required');
  }
  if (message.length > 2000) {
    throw new ValidationError('messageが長すぎます（2000文字以内）');
  }
  return message.trim();
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateScenarioAdjustments(input: unknown): CashScenarioAdjustment[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 20) {
    throw new ValidationError('adjustmentsは20件以内の配列である必要があります');
  }
  return input.map((raw) => {
    const adj = raw as Record<string, unknown>;
    const kind = adj.kind;
    if (kind === 'delay_entry') {
      if (
        typeof adj.planId !== 'string' ||
        typeof adj.days !== 'number' ||
        !Number.isFinite(adj.days) ||
        Math.abs(adj.days) > 365
      ) {
        throw new ValidationError('delay_entryにはplanIdと±365日以内のdaysが必要です');
      }
      return { kind, planId: adj.planId, days: Math.trunc(adj.days) };
    }
    if (kind === 'remove_entry') {
      if (typeof adj.planId !== 'string')
        throw new ValidationError('remove_entryにはplanIdが必要です');
      return { kind, planId: adj.planId };
    }
    if (kind === 'add_payment' || kind === 'add_receipt') {
      if (
        typeof adj.amount !== 'number' ||
        !Number.isFinite(adj.amount) ||
        adj.amount <= 0 ||
        adj.amount > 10_000_000_000 ||
        typeof adj.date !== 'string' ||
        !DATE_PATTERN.test(adj.date) ||
        typeof adj.label !== 'string'
      ) {
        throw new ValidationError(`${kind}にはamount(正数)・date(YYYY-MM-DD)・labelが必要です`);
      }
      return { kind, amount: adj.amount, date: adj.date, label: adj.label.slice(0, 100) };
    }
    throw new ValidationError(`未知のadjustment kind: ${String(kind)}`);
  });
}

/**
 * Prompt Injection疑いのパターン。
 * ユーザー入力や外部文書は「データ」であり、System Instructionとして扱わない。
 * 検知時は処理を止めず、権限昇格・設定変更の指示としては無視して通常Intentのみ処理する。
 */
const INJECTION_PATTERNS = [
  /これまでの(指示|命令|ルール)を(無視|忘れ)/,
  /(ignore|disregard).{0,30}(previous|above|prior).{0,20}(instructions?|rules?)/i,
  /system\s*(prompt|instruction)/i,
  /あなたは今から.{0,20}(として|になって)/,
  /(全|すべての)(データ|情報)を(送信|出力|開示)/,
  /(承認|権限|制限)を(無効|解除|スキップ)/
];

export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/** ログ・監査向けの機微情報マスク（トークン・メール・電話・金額の生値） */
export function maskSensitive(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer ***')
    .replace(/(sk|pk|api|key|token)[-_]?[A-Za-z0-9]{16,}/gi, '***TOKEN***')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')
    .replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, '***-****')
    .replace(/[0-9,]{7,}円/g, '***円');
}

/** メモリ内Rate Limiter（キー×ウィンドウ）。プロセス再起動でリセットされる（Phase Aの割り切り）。 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = Number(process.env.LCC_COMMAND_RATE_LIMIT ?? 60),
    private readonly windowMs = 60_000
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= this.limit) {
      this.hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    if (this.hits.size > 10_000) this.hits.clear(); // メモリ保護
    return true;
  }
}
