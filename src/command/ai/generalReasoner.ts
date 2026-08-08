/**
 * General Reasoning Fallback。
 * 固定Intent外の自由対話（相談・文章作成・雑談等）をModelRouter経由で処理する。
 *
 * 原則:
 * - 社内事実はプロンプトへ渡したTool/Memory由来の情報のみ。LLMの一般知識で捏造させない。
 * - Provider未接続（mock）の場合は、できない事を正直に伝える（それらしい回答を作らない）。
 */
import Anthropic from '@anthropic-ai/sdk';
import { ModelRouter, type CommandModelProvider } from './ModelRouter.js';

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
}

export function createGeneralRouter(
  env = process.env
): ModelRouter & { hasRealProvider?: boolean } {
  const hasKey = Boolean(env.ANTHROPIC_API_KEY);
  const router = new ModelRouter({
    routes: {},
    defaultRoute: hasKey ? ['anthropic', 'mock'] : ['mock']
  });
  if (hasKey) router.register(new AnthropicCommandModelProvider(env.ANTHROPIC_API_KEY as string));
  return Object.assign(router, { hasRealProvider: hasKey });
}

export class GeneralReasoner {
  private readonly hasRealProvider: boolean;

  constructor(private readonly router: ModelRouter & { hasRealProvider?: boolean }) {
    this.hasRealProvider = router.hasRealProvider ?? false;
  }

  get available(): boolean {
    return this.hasRealProvider;
  }

  /**
   * internalContext: Tool/Memoryから取得済みの社内事実（これ以外を社内事実として使わせない）
   */
  async answer(message: string, internalContext: string[]): Promise<GeneralAnswer> {
    if (!this.hasRealProvider) {
      return {
        text: [
          'この質問は汎用推論（自由対話）の領域ですが、現在この環境には生成AIモデルが接続されていません（ANTHROPIC_API_KEY未設定）。',
          'それらしい回答を捏造することはしません。',
          '',
          ...(internalContext.length > 0
            ? ['【確認できた社内の事実】', ...internalContext.map((c) => `・${c}`), '']
            : []),
          '社内データに関する質問（売上・現金・案件・請求・現場・記憶の呼び出し等）にはこのまま回答できます。'
        ].join('\n'),
        providerId: 'none',
        available: false
      };
    }
    const contextBlock =
      internalContext.length > 0
        ? `【社内コンテキスト】\n${internalContext.map((c) => `- ${c}`).join('\n')}\n\n`
        : '【社内コンテキスト】\n（この質問に関連する社内データはありません）\n\n';
    const result = await this.router.complete({
      purpose: 'conversation',
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `${contextBlock}【質問】\n${message}`
    });
    return { text: result.text, providerId: result.providerId, available: true };
  }
}
