import type { AnalyzeMessageInput, AnalyzeMessageResult } from '../domain/types.js';
import type { AIProvider } from './providers/AIProvider.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { MockAIProvider } from './providers/MockAIProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';

export function createAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER ?? 'mock';
  if (provider === 'openai') return new OpenAIProvider();
  if (provider === 'anthropic') return new AnthropicProvider();
  return new MockAIProvider();
}

export async function analyzeMessage(
  input: AnalyzeMessageInput,
  provider: AIProvider = createAIProvider()
): Promise<AnalyzeMessageResult> {
  return provider.analyzeMessage(input);
}
