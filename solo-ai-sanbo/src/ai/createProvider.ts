import type { AIProvider } from './providers/AIProvider.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { MockAIProvider } from './providers/MockAIProvider.js';

/** 既定はmock。APIキーなしで一通り動かせる状態を保つ。 */
export function createProvider(): AIProvider {
  if ((process.env.AI_PROVIDER ?? 'mock') === 'anthropic') return new AnthropicProvider();
  return new MockAIProvider();
}
