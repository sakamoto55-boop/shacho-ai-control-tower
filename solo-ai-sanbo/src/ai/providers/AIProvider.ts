import type { DraftRequest, DraftResult } from '../../domain/types.js';

/**
 * AI参謀は下書きを作るだけ。送信も投稿も金額の決定もしない。
 * 決めるのは本人、という前提をこのinterfaceの粒度で固定している。
 */
export interface AIProvider {
  draft(request: DraftRequest): Promise<DraftResult>;
}
