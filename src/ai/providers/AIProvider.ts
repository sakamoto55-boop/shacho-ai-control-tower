import type { AnalyzeMessageInput, AnalyzeMessageResult } from '../../domain/types.js';

export interface AIProvider {
  analyzeMessage(input: AnalyzeMessageInput): Promise<AnalyzeMessageResult>;
}
