/**
 * Model Router。業務Agentと特定モデル・ベンダーを密結合させないためのAdapter層。
 * 用途（purpose）ごとに最適なProviderを選び、障害時は候補リストの次へフォールバックする。
 * Phase A は決定論エンジン＋テンプレート回答のため Mock のみ登録するが、
 * AnthropicProvider / OpenAIProvider 等は既存 src/ai/providers と同じ要領で追加できる。
 */

export type ModelPurpose = 'conversation' | 'summarize' | 'draft' | 'analysis';

export interface ModelCompletionRequest {
  purpose: ModelPurpose;
  systemPrompt: string;
  userMessage: string;
}

export interface CommandModelProvider {
  providerId: string;
  complete(request: ModelCompletionRequest): Promise<string>;
}

export interface ModelRouteConfig {
  /** purposeごとの優先Provider ID列（先頭から試し、失敗したら次へ） */
  routes: Partial<Record<ModelPurpose, string[]>>;
  defaultRoute: string[];
}

export class MockCommandModelProvider implements CommandModelProvider {
  providerId = 'mock';

  async complete(request: ModelCompletionRequest): Promise<string> {
    // 決定論エンジンの結果整形はOrchestrator側テンプレートが担うため、Mockは素通しする
    return request.userMessage;
  }
}

export class ModelRouter {
  private readonly providers = new Map<string, CommandModelProvider>();

  constructor(private readonly config: ModelRouteConfig = { routes: {}, defaultRoute: ['mock'] }) {
    this.register(new MockCommandModelProvider());
  }

  register(provider: CommandModelProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  async complete(request: ModelCompletionRequest): Promise<{ providerId: string; text: string }> {
    const candidates = this.config.routes[request.purpose] ?? this.config.defaultRoute;
    let lastError: unknown;
    for (const providerId of candidates) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;
      try {
        return { providerId, text: await provider.complete(request) };
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `利用可能なモデルProviderがありません: ${String(lastError ?? 'no provider registered')}`
    );
  }
}
