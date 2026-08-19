import Anthropic from '@anthropic-ai/sdk';
import type { DraftRequest, DraftResult } from '../../domain/types.js';
import { buildDraftPrompt, SANBO_SYSTEM_PROMPT } from '../prompts.js';
import type { AIProvider } from './AIProvider.js';

interface RawDraft {
  text?: string;
  checkBeforeSending?: string[];
  leftToYou?: string[];
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('AI_PROVIDER=anthropic には ANTHROPIC_API_KEY が必要です。');
    }
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async draft(request: DraftRequest): Promise<DraftResult> {
    const response = await this.client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-5',
      max_tokens: 2048,
      system: SANBO_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildDraftPrompt(request) }]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Anthropicから想定外の形式が返りました。');
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Anthropicの返答にJSONが含まれていません。');
    }

    const raw = JSON.parse(jsonMatch[0]) as RawDraft;
    return {
      kind: request.kind,
      text: raw.text ?? '',
      checkBeforeSending: raw.checkBeforeSending ?? [],
      leftToYou: raw.leftToYou ?? []
    };
  }
}
