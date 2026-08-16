import type {
  AnalyzeMessageInput,
  AnalyzeMessageResult,
  SnsInquiryAnalysisResult,
  SnsInquiryInput,
  SnsPostDraftResult,
  SnsPostGenerationInput
} from '../../domain/types.js';

export interface AIProvider {
  analyzeMessage(input: AnalyzeMessageInput): Promise<AnalyzeMessageResult>;
  /** SNSのDM・コメント・フォーム反響を見込み客として分析する */
  analyzeSnsInquiry(input: SnsInquiryInput): Promise<SnsInquiryAnalysisResult>;
  /** 投稿カレンダーの1コマからSNS投稿の下書きを作る（投稿はしない） */
  generateSnsPost(input: SnsPostGenerationInput): Promise<SnsPostDraftResult>;
}
