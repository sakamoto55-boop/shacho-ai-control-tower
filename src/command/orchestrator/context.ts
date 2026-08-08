/**
 * 会話コンテキスト。単発Intent判定ではなく、
 * 「それ」「さっきの」「2番目」「もっと詳しく」等の追い質問を成立させるために
 * セッションごとに直前の話題・対象・根拠を保持する。
 *
 * Phase Aはメモリ内保持（TTL 30分・上限200セッション）。永続化はPhase Bで検討する。
 */
import type { CompanyScope, DataConfidence, Evidence } from '../domain/types.js';

export type IntentKey =
  | 'brief'
  | 'sales'
  | 'cash'
  | 'cash_scenario'
  | 'risky'
  | 'invoices'
  | 'today'
  | 'pipeline'
  | 'project_card'
  | 'margin_why'
  | 'last_contact'
  | 'employee'
  | 'research'
  | 'draft'
  | 'send'
  | 'advice'
  | 'compound'
  | 'unknown';

export interface ContextListItem {
  id: string;
  kind: 'project' | 'leak' | 'alert' | 'pipeline';
  label: string;
  projectId?: string;
}

export interface ConversationContext {
  sessionId: string;
  scope: CompanyScope;
  lastIntent: IntentKey | null;
  lastProjectId: string | null;
  lastCustomerId: string | null;
  /** 直前に提示したリスト（ランキング・パイプライン等）。「2番目」「他にない？」の解決に使う */
  lastListItems: ContextListItem[];
  /** リストのうち既に表示した件数 */
  lastListShown: number;
  lastDraft: { text: string; customerName: string; customerId?: string; projectId?: string } | null;
  lastEvidence: Evidence[];
  lastConfidence: DataConfidence;
  updatedAtMs: number;
}

const TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 200;

export function emptyContext(sessionId: string, scope: CompanyScope): ConversationContext {
  return {
    sessionId,
    scope,
    lastIntent: null,
    lastProjectId: null,
    lastCustomerId: null,
    lastListItems: [],
    lastListShown: 0,
    lastDraft: null,
    lastEvidence: [],
    lastConfidence: 'UNKNOWN',
    updatedAtMs: Date.now()
  };
}

export class ContextStore {
  private readonly sessions = new Map<string, ConversationContext>();

  get(sessionId: string, defaultScope: CompanyScope): ConversationContext {
    const existing = this.sessions.get(sessionId);
    if (existing && Date.now() - existing.updatedAtMs < TTL_MS) return existing;
    const fresh = emptyContext(sessionId, defaultScope);
    this.sessions.set(sessionId, fresh);
    return fresh;
  }

  save(context: ConversationContext): void {
    context.updatedAtMs = Date.now();
    this.sessions.set(context.sessionId, context);
    if (this.sessions.size > MAX_SESSIONS) {
      const oldest = [...this.sessions.entries()].sort(
        (a, b) => a[1].updatedAtMs - b[1].updatedAtMs
      )[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
  }
}
