import type { AnalyzeMessageInput, AnalyzeMessageResult } from '../../domain/types.js';
import type { AIProvider } from './AIProvider.js';

export class AnthropicProvider implements AIProvider {
  async analyzeMessage(_input: AnalyzeMessageInput): Promise<AnalyzeMessageResult> {
    throw new Error('AnthropicProvider is not implemented in Phase 1. Use AI_PROVIDER=mock.');
  }
}
