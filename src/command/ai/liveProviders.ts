/**
 * 実Provider Adapter層（Phase LIVE-AI §7-§11・§38）。
 *
 * - LCC COMMANDは特定AIのラッパーではない。Role→Capability→Providerの構造を維持し、
 *   ここに追加されるAdapterは「Capabilityの実装手段」にすぎない。
 * - API Key未設定はNOT_CONFIGUREDの正常状態（全体をエラーにしない）。
 * - 資格情報はenvのみ（コード・Git・ログ・フロント露出禁止）。
 * - 通常はAuto選択。上級操作として「Claudeで」「Geminiでも確認」等の指定を許可（§38）。
 */
import type { CommandModelProvider, ModelCompletionRequest } from './ModelRouter.js';

/** OpenAI Chat Completions Adapter（§9） */
export class OpenAICommandModelProvider implements CommandModelProvider {
  providerId = 'openai';
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.LCC_COMMAND_OPENAI_MODEL ?? 'gpt-5',
    fetchImpl: typeof fetch = fetch
  ) {
    this.fetchImpl = fetchImpl;
  }

  async complete(request: ModelCompletionRequest): Promise<string> {
    const res = await this.fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userMessage }
        ]
      })
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content ?? '';
  }
}

/** Google Gemini Adapter（§10） */
export class GeminiCommandModelProvider implements CommandModelProvider {
  providerId = 'gemini';
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.LCC_COMMAND_GEMINI_MODEL ?? 'gemini-2.5-pro',
    fetchImpl: typeof fetch = fetch
  ) {
    this.fetchImpl = fetchImpl;
  }

  async complete(request: ModelCompletionRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: request.userMessage }] }]
      })
    });
    if (!res.ok) throw new Error(`Gemini API ${res.status}`);
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  }
}

/** OpenAI Images Adapter（§20 IMAGE_GENERATION。Providerを固定しないための1実装） */
export class OpenAIImageProvider {
  providerId = 'openai-image';
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.LCC_COMMAND_IMAGE_MODEL ?? 'gpt-image-1',
    fetchImpl: typeof fetch = fetch
  ) {
    this.fetchImpl = fetchImpl;
  }

  async generateImage(prompt: string, size = '1024x1024'): Promise<{ base64Png: string }> {
    const res = await this.fetchImpl('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ model: this.model, prompt, size, n: 1 })
    });
    if (!res.ok) throw new Error(`OpenAI Images API ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new Error('画像データが返されませんでした');
    return { base64Png: b64 };
  }
}

/** Manus Adapter（§11）。非同期Task + Webhook前提。ManusはRoleではなくProvider */
export interface ManusTaskSpec {
  kind: 'DEEP_RESEARCH' | 'LONG_RUNNING_TASK' | 'ARTIFACT_GENERATION' | 'WEB_RESEARCH';
  instruction: string;
  contextSummary?: string;
}

export class ManusAdapter {
  providerId = 'manus';
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    baseUrl = process.env.MANUS_BASE_URL ?? 'https://api.manus.ai',
    fetchImpl: typeof fetch = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
  }

  /** 外部調査タスクの発行（READ ONLY。社内機微データは渡さない） */
  async submitTask(spec: ManusTaskSpec): Promise<{ taskRef: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        kind: spec.kind,
        instruction: spec.instruction,
        context: spec.contextSummary ?? ''
      })
    });
    if (!res.ok) throw new Error(`Manus API ${res.status}`);
    const body = (await res.json()) as { taskId?: string; id?: string };
    const taskRef = body.taskId ?? body.id;
    if (!taskRef) throw new Error('ManusタスクIDが返されませんでした');
    return { taskRef };
  }
}

/** §38: 上級操作としてのProvider指定（通常はAuto） */
export function parsePreferredProvider(
  message: string
): 'anthropic' | 'openai' | 'gemini' | 'manus' | null {
  if (/Claude|クロード/i.test(message)) return 'anthropic';
  if (/GPT|OpenAI|ChatGPT/i.test(message)) return 'openai';
  if (/Gemini|ジェミニ/i.test(message)) return 'gemini';
  if (/Manus|マヌス/i.test(message)) return 'manus';
  return null;
}

export interface LiveProviderStatus {
  anthropic: boolean;
  openai: boolean;
  gemini: boolean;
  manus: boolean;
  imageGeneration: boolean;
}

export function liveProviderStatus(env = process.env): LiveProviderStatus {
  return {
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY),
    manus: Boolean(env.MANUS_API_KEY),
    imageGeneration: Boolean(env.OPENAI_API_KEY)
  };
}
