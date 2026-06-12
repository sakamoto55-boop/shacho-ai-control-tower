import type { AnalyzeMessageInput, AnalyzeMessageResult } from '../../domain/types.js';
import type { AIProvider } from './AIProvider.js';

export class OpenAIProvider implements AIProvider {
  async analyzeMessage(_input: AnalyzeMessageInput): Promise<AnalyzeMessageResult> {
    throw new Error('OpenAIProvider is not implemented in Phase 1. Use AI_PROVIDER=mock.');
  }
}
