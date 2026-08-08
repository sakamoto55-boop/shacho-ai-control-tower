/**
 * Model / Provider Registry（Phase N §6-§8）。
 *
 * Providerは交換可能な実装であり、未設定でも全体を停止させない。
 * Roleにモデルを固定せず、Capability Scoreで動的選択する。
 * 障害時はFallbackするが、Data Policy（機微データの扱い）を満たせない
 * 切替は行わず、ユーザーへ説明する。
 */
import type { Capability } from './roles.js';

export type CostClass = 'LOW' | 'MEDIUM' | 'HIGH';
export type LatencyClass = 'FAST' | 'MEDIUM' | 'SLOW';

export interface ProviderSpec {
  providerId: string;
  vendor: 'OpenAI' | 'Anthropic' | 'Google' | 'Manus' | 'Internal' | 'Other';
  model: string;
  capabilities: Capability[];
  costClass: CostClass;
  latencyClass: LatencyClass;
  contextWindow: number;
  toolCalling: boolean;
  structuredOutput: boolean;
  webResearch: boolean;
  longRunning: boolean;
  vision: boolean;
  audio: boolean;
  /** 0-1。宣言値＋実績で更新される */
  reliability: number;
  /** 機微データ（給与等）を渡してよいProviderか（Data Policy） */
  allowsSensitiveData: boolean;
  available: boolean;
}

export interface ProviderSelection {
  provider: ProviderSpec | null;
  /** 選定理由（Observability用。ユーザーへは露出しない） */
  reason: string;
  /** Data Policy違反でFallbackを拒否した場合の説明（ユーザー向け） */
  policyBlock?: string;
}

interface Outcome {
  success: number;
  failure: number;
  lastSuccess?: string;
  lastFailure?: string;
}

/** Provider Configuration（Phase B1.5 §4）。未設定Providerはエラーではなく正常状態 */
export interface ProviderStatusView {
  providerId: string;
  vendor: ProviderSpec['vendor'];
  model: string;
  enabled: boolean;
  available: boolean;
  /** NOT_CONFIGURED = API Key未設定（正常状態。全体をエラーにしない） */
  status: 'READY' | 'NOT_CONFIGURED' | 'DEGRADED';
  capabilities: Capability[];
  dataPolicy: 'SENSITIVE_ALLOWED' | 'NO_SENSITIVE';
  costClass: CostClass;
  latencyClass: LatencyClass;
  health: {
    successRate: number;
    samples: number;
    lastSuccess?: string;
    lastFailure?: string;
  };
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderSpec>();
  private readonly outcomes = new Map<string, Outcome>();

  register(spec: ProviderSpec): void {
    this.providers.set(spec.providerId, spec);
  }

  get(providerId: string): ProviderSpec | undefined {
    return this.providers.get(providerId);
  }

  list(): ProviderSpec[] {
    return [...this.providers.values()];
  }

  /** Historical Success Rate（動的選択の評価要素） */
  successRate(providerId: string): number {
    const outcome = this.outcomes.get(providerId);
    if (!outcome || outcome.success + outcome.failure === 0) return 0.5;
    return outcome.success / (outcome.success + outcome.failure);
  }

  recordOutcome(providerId: string, success: boolean, at = new Date().toISOString()): void {
    const outcome = this.outcomes.get(providerId) ?? { success: 0, failure: 0 };
    if (success) {
      outcome.success += 1;
      outcome.lastSuccess = at;
    } else {
      outcome.failure += 1;
      outcome.lastFailure = at;
    }
    this.outcomes.set(providerId, outcome);
  }

  /** Provider Configuration一覧（§4）。API Key未設定はNOT_CONFIGUREDとして正常扱い */
  describe(): ProviderStatusView[] {
    return this.list().map((spec) => {
      const outcome = this.outcomes.get(spec.providerId);
      const samples = (outcome?.success ?? 0) + (outcome?.failure ?? 0);
      const successRate = this.successRate(spec.providerId);
      const status: ProviderStatusView['status'] = !spec.available
        ? 'NOT_CONFIGURED'
        : samples >= 3 && successRate < 0.5
          ? 'DEGRADED'
          : 'READY';
      return {
        providerId: spec.providerId,
        vendor: spec.vendor,
        model: spec.model,
        enabled: true,
        available: spec.available,
        status,
        capabilities: spec.capabilities,
        dataPolicy: spec.allowsSensitiveData ? 'SENSITIVE_ALLOWED' : 'NO_SENSITIVE',
        costClass: spec.costClass,
        latencyClass: spec.latencyClass,
        health: {
          successRate,
          samples,
          lastSuccess: outcome?.lastSuccess,
          lastFailure: outcome?.lastFailure
        }
      };
    });
  }

  /** Capability Scoreによる動的選択。preferred → fallback の順に評価する */
  select(
    required: Capability[],
    preferred: string[],
    fallback: string[],
    options: { needsSensitive?: boolean; excludeIds?: string[] } = {}
  ): ProviderSelection {
    const candidates = [...preferred, ...fallback]
      .map((id) => this.providers.get(id))
      .filter((p): p is ProviderSpec => p !== undefined)
      .filter((p) => !(options.excludeIds ?? []).includes(p.providerId));

    let policyBlock: string | undefined;
    let best: { provider: ProviderSpec; score: number } | null = null;
    for (const provider of candidates) {
      if (!provider.available) continue;
      const missing = required.filter((cap) => !provider.capabilities.includes(cap));
      if (missing.length > 0) continue;
      if (options.needsSensitive && !provider.allowsSensitiveData) {
        // Data Policyを満たさないProviderへは切り替えない（勝手に妥協しない）
        policyBlock = `機微データを扱うため、Provider「${provider.providerId}」へは切り替えられません（Data Policy）`;
        continue;
      }
      const score =
        this.successRate(provider.providerId) * 3 +
        provider.reliability * 2 +
        (provider.costClass === 'LOW' ? 1 : provider.costClass === 'MEDIUM' ? 0.5 : 0) +
        (provider.latencyClass === 'FAST' ? 1 : provider.latencyClass === 'MEDIUM' ? 0.5 : 0) +
        (preferred.includes(provider.providerId) ? 1.5 : 0);
      if (!best || score > best.score) best = { provider, score };
    }
    if (!best) {
      return {
        provider: null,
        reason: '要求Capabilityを満たす利用可能なProviderがありません',
        policyBlock
      };
    }
    return {
      provider: best.provider,
      reason: `capability score選択（成功率${(this.successRate(best.provider.providerId) * 100).toFixed(0)}%）`
    };
  }
}

/**
 * 既定Registry。未設定Providerは available:false のまま登録し、
 * 存在自体は認識しつつ全体を止めない。ManusはRoleではなくProvider候補（§39）。
 */
export function createDefaultRegistry(env = process.env): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register({
    providerId: 'deterministic',
    vendor: 'Internal',
    model: 'lcc-deterministic-engines',
    capabilities: ['deterministic_calc', 'tool_calling', 'structured_output', 'memory_access'],
    costClass: 'LOW',
    latencyClass: 'FAST',
    contextWindow: 0,
    toolCalling: true,
    structuredOutput: true,
    webResearch: false,
    longRunning: false,
    vision: false,
    audio: false,
    reliability: 0.99,
    allowsSensitiveData: true, // 社内実行のみ・外部送信なし
    available: true
  });
  registry.register({
    providerId: 'anthropic',
    vendor: 'Anthropic',
    model: env.LCC_COMMAND_MODEL ?? 'claude-sonnet-5',
    capabilities: ['reasoning', 'writing', 'structured_output', 'tool_calling', 'memory_access'],
    costClass: 'MEDIUM',
    latencyClass: 'MEDIUM',
    contextWindow: 200_000,
    toolCalling: true,
    structuredOutput: true,
    webResearch: false,
    longRunning: false,
    vision: true,
    audio: false,
    reliability: 0.95,
    allowsSensitiveData: false, // 外部APIのため既定では機微データを渡さない
    available: Boolean(env.ANTHROPIC_API_KEY)
  });
  registry.register({
    providerId: 'openai',
    vendor: 'OpenAI',
    model: 'gpt-5',
    capabilities: ['reasoning', 'writing', 'structured_output', 'tool_calling'],
    costClass: 'MEDIUM',
    latencyClass: 'MEDIUM',
    contextWindow: 200_000,
    toolCalling: true,
    structuredOutput: true,
    webResearch: false,
    longRunning: false,
    vision: true,
    audio: true,
    reliability: 0.95,
    allowsSensitiveData: false,
    available: Boolean(env.OPENAI_API_KEY)
  });
  registry.register({
    providerId: 'gemini',
    vendor: 'Google',
    model: env.LCC_COMMAND_GEMINI_MODEL ?? 'gemini-2.5-pro',
    capabilities: ['reasoning', 'writing', 'structured_output', 'web_research'],
    costClass: 'MEDIUM',
    latencyClass: 'MEDIUM',
    contextWindow: 1_000_000,
    toolCalling: true,
    structuredOutput: true,
    webResearch: true,
    longRunning: false,
    vision: true,
    audio: true,
    reliability: 0.95,
    allowsSensitiveData: false,
    available: Boolean(env.GEMINI_API_KEY)
  });
  registry.register({
    providerId: 'manus',
    vendor: 'Manus',
    model: 'manus-agent',
    capabilities: ['web_research', 'long_running'],
    costClass: 'HIGH',
    latencyClass: 'SLOW',
    contextWindow: 0,
    toolCalling: true,
    structuredOutput: false,
    webResearch: true,
    longRunning: true,
    vision: false,
    audio: false,
    reliability: 0.9,
    allowsSensitiveData: false,
    available: Boolean(env.MANUS_API_KEY)
  });
  return registry;
}
