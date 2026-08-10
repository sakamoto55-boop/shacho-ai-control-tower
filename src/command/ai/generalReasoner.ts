/**
 * General Reasoning Fallback。
 * 固定Intent外の自由対話（相談・文章作成・雑談等）をModelRouter経由で処理する。
 *
 * 原則:
 * - 社内事実はプロンプトへ渡したTool/Memory由来の情報のみ。LLMの一般知識で捏造させない。
 * - Provider未接続（mock）の場合は、できない事を正直に伝える（それらしい回答を作らない）。
 * - 是正⑦: productionでは実Provider失敗時にmockへフォールバックしない。
 *   質問文のエコーバック・接続済みを装う回答を禁止し、正直な利用不能応答を返す。
 */
import Anthropic from '@anthropic-ai/sdk';
import { ModelRouter, type CommandModelProvider } from './ModelRouter.js';
import { GeminiCommandModelProvider, OpenAICommandModelProvider } from './liveProviders.js';
import { classifyProviderError, type AiReasonCode } from './providerVerification.js';

/** Anthropic実Provider。ANTHROPIC_API_KEY設定時のみ登録される */
export class AnthropicCommandModelProvider implements CommandModelProvider {
  providerId = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model = process.env.LCC_COMMAND_MODEL ?? 'claude-sonnet-5'
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(request: { systemPrompt: string; userMessage: string }): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1500,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userMessage }]
    });
    const block = response.content.find((item) => item.type === 'text');
    return block && 'text' in block ? block.text : '';
  }
}

const SYSTEM_PROMPT = [
  'あなたは株式会社LCC（建設・解体・外構・不動産・福祉）の経営支援AI「LCC COMMAND」です。',
  '以下を厳守してください。',
  '- 「社内の事実」として使ってよいのは、この後に【社内コンテキスト】として渡す情報のみ。',
  '- 渡されていない社内の数値・人名・案件・方針を推測で述べない。不明な点は「社内データにありません」と言う。',
  '- 事実と意見・提案を分けて書く（【確認できた事実】【AIの分析・提案】）。',
  '- 金額・契約・納期・人事の確定的な指示はしない（最終判断は経営者）。',
  '- 簡潔さを求められたら簡潔に答える。'
].join('\n');

export interface GeneralAnswer {
  text: string;
  providerId: string;
  available: boolean;
  /** available=falseの理由（内部コード。UIへはそのまま出さず正直な日本語文を出す） */
  reasonCode?: AiReasonCode;
}

/** LLM障害の診断記録（是正⑦。キー・会話本文は含めない） */
export interface LlmDiagnostic {
  providerStatus: string;
  reasonCode: AiReasonCode;
  occurredAt: string;
  retryable: boolean;
}

/** productionではmockフォールバック禁止（明示設定 LCC_COMMAND_ALLOW_MOCK_LLM=true でのみ許可） */
export function isMockFallbackAllowed(env = process.env): boolean {
  if (env.LCC_COMMAND_ALLOW_MOCK_LLM === 'true') return true;
  const production = env.LCC_COMMAND_MODE === 'production' || env.NODE_ENV === 'production';
  return !production;
}

export function createGeneralRouter(
  env = process.env
): ModelRouter & { hasRealProvider?: boolean } {
  // 実Providerの登録（Phase LIVE-AI §7: Anthropic → OpenAI → Gemini の優先順。固定はしない）
  const order: string[] = [];
  if (env.ANTHROPIC_API_KEY) order.push('anthropic');
  if (env.OPENAI_API_KEY) order.push('openai');
  if (env.GEMINI_API_KEY) order.push('gemini');
  // 是正⑦: productionのdefaultRouteへmockを入れない（実Provider全滅時はrouterがthrowし、
  // GeneralReasonerが正直な利用不能応答へ変換する）
  const defaultRoute = isMockFallbackAllowed(env) ? [...order, 'mock'] : order;
  const router = new ModelRouter({ routes: {}, defaultRoute });
  if (env.ANTHROPIC_API_KEY) router.register(new AnthropicCommandModelProvider(env.ANTHROPIC_API_KEY));
  if (env.OPENAI_API_KEY) router.register(new OpenAICommandModelProvider(env.OPENAI_API_KEY));
  if (env.GEMINI_API_KEY) router.register(new GeminiCommandModelProvider(env.GEMINI_API_KEY));
  return Object.assign(router, { hasRealProvider: order.length > 0 });
}

/** 正直な利用不能応答（質問文のエコーバック・架空回答をしない） */
function unavailableText(internalContext: string[]): string {
  return [
    '現在、相談AIへ接続できません。',
    'Memory検索と社内データ検索は利用できますが、生成AIによる新しい回答は一時的に利用できません。',
    '',
    ...(internalContext.length > 0
      ? ['【確認できた社内の事実】', ...internalContext.map((c) => `・${c}`), '']
      : []),
    'それらしい回答を捏造することはしません。復旧後にもう一度お尋ねください。'
  ].join('\n');
}

export class GeneralReasoner {
  private readonly hasRealProvider: boolean;

  constructor(
    private readonly router: ModelRouter & { hasRealProvider?: boolean },
    private readonly onDiagnostic?: (diagnostic: LlmDiagnostic) => void
  ) {
    this.hasRealProvider = router.hasRealProvider ?? false;
  }

  get available(): boolean {
    return this.hasRealProvider;
  }

  /**
   * internalContext: Tool/Memoryから取得済みの社内事実（これ以外を社内事実として使わせない）
   */
  async answer(
    message: string,
    internalContext: string[],
    preferredProviderId?: string
  ): Promise<GeneralAnswer> {
    if (!this.hasRealProvider) {
      this.onDiagnostic?.({
        providerStatus: 'NOT_CONFIGURED',
        reasonCode: 'AI_NOT_CONFIGURED',
        occurredAt: new Date().toISOString(),
        retryable: false
      });
      return {
        text: [
          'この質問は汎用推論（自由対話）の領域ですが、現在この環境には生成AIモデルが接続されていません（ANTHROPIC/OPENAI/GEMINIのAPI Keyいずれも未設定）。',
          'それらしい回答を捏造することはしません。',
          '',
          ...(internalContext.length > 0
            ? ['【確認できた社内の事実】', ...internalContext.map((c) => `・${c}`), '']
            : []),
          '社内データに関する質問（売上・現金・案件・請求・現場・記憶の呼び出し等）にはこのまま回答できます。'
        ].join('\n'),
        providerId: 'none',
        available: false,
        reasonCode: 'AI_NOT_CONFIGURED'
      };
    }
    const contextBlock =
      internalContext.length > 0
        ? `【社内コンテキスト】\n${internalContext.map((c) => `- ${c}`).join('\n')}\n\n`
        : '【社内コンテキスト】\n（この質問に関連する社内データはありません）\n\n';
    try {
      const result = await this.router.complete(
        {
          purpose: 'conversation',
          systemPrompt: SYSTEM_PROMPT,
          userMessage: `${contextBlock}【質問】\n${message}`
        },
        preferredProviderId
      );
      // mockは入力素通し実装のため、万一経由しても「回答」として返さない（エコーバック禁止）
      if (result.providerId === 'mock') {
        this.onDiagnostic?.({
          providerStatus: 'MOCK_ONLY',
          reasonCode: 'AI_TEMPORARILY_UNAVAILABLE',
          occurredAt: new Date().toISOString(),
          retryable: true
        });
        return {
          text: unavailableText(internalContext),
          providerId: 'none',
          available: false,
          reasonCode: 'AI_TEMPORARILY_UNAVAILABLE'
        };
      }
      return { text: result.text, providerId: result.providerId, available: true };
    } catch (error) {
      const reasonCode = classifyProviderError(error);
      this.onDiagnostic?.({
        providerStatus: reasonCode.replace('AI_', ''),
        reasonCode,
        occurredAt: new Date().toISOString(),
        retryable: reasonCode !== 'AI_AUTH_FAILED'
      });
      return {
        text: unavailableText(internalContext),
        providerId: 'none',
        available: false,
        reasonCode
      };
    }
  }
}
