/**
 * Intelligence Store（§2）。JSONL追記型の永続層。
 *
 * - 置き場: %LOCALAPPDATA%\LCC_COMMAND\data\intelligence\（既存Vault/Repositoryと分離・READ ONLY方針を壊さない）
 * - 冪等性: RawEventは source|externalId|revision キー + contentHash。同一入力から重複レコードを作らない。
 * - 原文改変禁止・削除禁止（supersededByによる履歴接続のみ）。
 * - 再起動後も全レコードが復元される（§12-8）。
 */
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentRun,
  DecisionCase,
  ImprovementProposal,
  IntelligenceActionItem,
  IntelligenceSource,
  KnowledgeFact,
  Outcome,
  RawEvent,
  RuleVersion
} from './types.js';

export function defaultIntelligenceDir(): string {
  const base = process.env.LCC_INTELLIGENCE_DIR
    ?? join(process.env.LOCALAPPDATA ?? '.', 'LCC_COMMAND', 'data', 'intelligence');
  return base;
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

export const contentHashOf = (content: unknown): string =>
  createHash('sha256').update(canonicalStringify(content)).digest('hex');

const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

type Kind =
  | 'raw-events' | 'knowledge-facts' | 'decision-cases' | 'action-items'
  | 'agent-runs' | 'outcomes' | 'improvement-proposals' | 'rule-versions';

export class IntelligenceStore {
  private cache = new Map<Kind, unknown[]>();

  constructor(private readonly dir = defaultIntelligenceDir()) {
    mkdirSync(this.dir, { recursive: true });
  }

  private file(kind: Kind): string { return join(this.dir, `${kind}.jsonl`); }

  private load<T>(kind: Kind): T[] {
    if (this.cache.has(kind)) return this.cache.get(kind) as T[];
    const f = this.file(kind);
    const rows: T[] = [];
    if (existsSync(f)) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { rows.push(JSON.parse(line) as T); } catch { /* 壊れた行はスキップ（偽データで補わない） */ }
      }
    }
    this.cache.set(kind, rows);
    return rows;
  }

  private append<T>(kind: Kind, row: T): T {
    appendFileSync(this.file(kind), `${JSON.stringify(row)}\n`, 'utf8');
    this.load<T>(kind).push(row);
    return row;
  }

  /* ---------------- RawEvent（冪等・immutable） ---------------- */

  /** 既存なら既存を返す（重複作成しない）。revision違いは新規、同一hashはスキップ */
  ingestRawEvent(input: {
    companyId: string; source: IntelligenceSource; externalId: string;
    revision?: number; receivedAt?: string; content: Record<string, unknown>;
  }): { event: RawEvent; deduplicated: boolean } {
    const hash = contentHashOf(input.content);
    const all = this.load<RawEvent>('raw-events');
    const dupByKey = all.find(
      (e) => e.source === input.source && e.externalId === input.externalId && e.revision === (input.revision ?? 1)
    );
    if (dupByKey) return { event: dupByKey, deduplicated: true };
    const dupByHash = all.find((e) => e.source === input.source && e.contentHash === hash);
    if (dupByHash) return { event: dupByHash, deduplicated: true };
    const event: RawEvent = {
      rawEventId: newId('raw'),
      companyId: input.companyId,
      source: input.source,
      externalId: input.externalId,
      revision: input.revision ?? 1,
      contentHash: hash,
      receivedAt: input.receivedAt ?? new Date().toISOString(),
      content: input.content
    };
    return { event: this.append('raw-events', event), deduplicated: false };
  }

  rawEvents(): RawEvent[] { return [...this.load<RawEvent>('raw-events')]; }

  /* ---------------- KnowledgeFact（訂正=supersededBy） ---------------- */

  addFact(fact: Omit<KnowledgeFact, 'factId' | 'createdAt' | 'supersededBy'>): KnowledgeFact {
    return this.append('knowledge-facts', {
      ...fact, factId: newId('fact'), createdAt: new Date().toISOString(), supersededBy: null
    });
  }

  /** 訂正: 旧factは削除せずsupersededByで新版へ接続（CORRECTION種別の新factを作成） */
  correctFact(oldFactId: string, corrected: Omit<KnowledgeFact, 'factId' | 'createdAt' | 'supersededBy' | 'kind'>): KnowledgeFact | null {
    const facts = this.load<KnowledgeFact>('knowledge-facts');
    const old = facts.find((f) => f.factId === oldFactId);
    if (!old || old.supersededBy) return null;
    const next = this.append<KnowledgeFact>('knowledge-facts', {
      ...corrected, kind: 'CORRECTION', factId: newId('fact'), createdAt: new Date().toISOString(), supersededBy: null
    });
    old.supersededBy = next.factId;
    // supersededマーカー行を追記（読込時に最後の状態が勝つ）
    this.append('knowledge-facts', { ...old });
    return next;
  }

  /** 現行事実のみ（supersededは除外。ただし履歴としては保持され検索可能） */
  currentFacts(): KnowledgeFact[] {
    const byId = new Map<string, KnowledgeFact>();
    for (const f of this.load<KnowledgeFact>('knowledge-facts')) byId.set(f.factId, f);
    return [...byId.values()].filter((f) => !f.supersededBy);
  }

  allFactsIncludingSuperseded(): KnowledgeFact[] {
    const byId = new Map<string, KnowledgeFact>();
    for (const f of this.load<KnowledgeFact>('knowledge-facts')) byId.set(f.factId, f);
    return [...byId.values()];
  }

  /* ---------------- DecisionCase / ActionItem ---------------- */

  addCase(c: Omit<DecisionCase, 'caseId' | 'createdAt' | 'supersededBy'>): DecisionCase {
    return this.append('decision-cases', { ...c, caseId: newId('case'), createdAt: new Date().toISOString(), supersededBy: null });
  }

  updateCaseStatus(caseId: string, status: DecisionCase['status'], actualOutcome?: string): DecisionCase | null {
    const rows = this.load<DecisionCase>('decision-cases');
    const hit = [...rows].reverse().find((r) => r.caseId === caseId);
    if (!hit) return null;
    const updated = { ...hit, status, actualOutcome: actualOutcome ?? hit.actualOutcome };
    return this.append('decision-cases', updated);
  }

  cases(): DecisionCase[] {
    const byId = new Map<string, DecisionCase>();
    for (const c of this.load<DecisionCase>('decision-cases')) byId.set(c.caseId, c);
    return [...byId.values()];
  }

  addAction(a: Omit<IntelligenceActionItem, 'actionId' | 'createdAt' | 'completedAt'>): IntelligenceActionItem {
    return this.append('action-items', { ...a, actionId: newId('act'), createdAt: new Date().toISOString(), completedAt: null });
  }

  updateActionStatus(actionId: string, status: IntelligenceActionItem['status']): IntelligenceActionItem | null {
    const rows = this.load<IntelligenceActionItem>('action-items');
    const hit = [...rows].reverse().find((r) => r.actionId === actionId);
    if (!hit) return null;
    const updated = { ...hit, status, completedAt: status === 'COMPLETED' ? new Date().toISOString() : hit.completedAt };
    return this.append('action-items', updated);
  }

  actions(): IntelligenceActionItem[] {
    const byId = new Map<string, IntelligenceActionItem>();
    for (const a of this.load<IntelligenceActionItem>('action-items')) byId.set(a.actionId, a);
    return [...byId.values()];
  }

  /**
   * 返信待ちタスクの自動再開（WAITING_*→GATHERING_INFORMATIONへ）。
   *
   * 照合規則（§D: 同一room内の無関係メッセージで全タスクを再開しない）:
   * - gmail:<threadId> はスレッド単位で特定できるため watchKey一致のみで再開する。
   * - lineworks:<roomId> はroom単位でしか特定できないため、watchKey一致に加えて
   *   新着メッセージのEntity（○○邸・○○様等）とタスクのEntityの重なりを必須にする。
   *   Entityが照合できない場合は再開しない（誤再開より見逃しの方が復旧容易＝手動再開可能）。
   */
  resumeWaitingByWatchKey(watchKey: string, incomingEntities: Array<{ name: string }> = []): IntelligenceActionItem[] {
    const resumed: IntelligenceActionItem[] = [];
    const threadPrecise = watchKey.startsWith('gmail:');
    for (const a of this.actions()) {
      if (a.watchKey !== watchKey || !(a.status === 'WAITING_EXTERNAL' || a.status === 'WAITING_STAFF')) continue;
      if (!threadPrecise) {
        const overlap = a.entities.some((e) => incomingEntities.some((i) => i.name === e.name));
        if (!overlap) continue; // room単位watchKeyはEntity照合が取れた場合のみ再開
      }
      const u = this.updateActionStatus(a.actionId, 'GATHERING_INFORMATION');
      if (u) resumed.push(u);
    }
    return resumed;
  }

  /* ---------------- AgentRun / Outcome / Proposal / RuleVersion ---------------- */

  addAgentRun(r: Omit<AgentRun, 'runId'>): AgentRun { return this.append('agent-runs', { ...r, runId: newId('run') }); }
  updateAgentRun(runId: string, patch: Partial<AgentRun>): AgentRun | null {
    const hit = [...this.load<AgentRun>('agent-runs')].reverse().find((r) => r.runId === runId);
    if (!hit) return null;
    return this.append('agent-runs', { ...hit, ...patch, runId });
  }
  agentRuns(): AgentRun[] {
    const byId = new Map<string, AgentRun>();
    for (const r of this.load<AgentRun>('agent-runs')) byId.set(r.runId, r);
    return [...byId.values()];
  }

  addOutcome(o: Omit<Outcome, 'outcomeId' | 'recordedAt'>): Outcome {
    return this.append('outcomes', { ...o, outcomeId: newId('out'), recordedAt: new Date().toISOString() });
  }
  outcomes(): Outcome[] { return [...this.load<Outcome>('outcomes')]; }

  addProposal(p: Omit<ImprovementProposal, 'proposalId' | 'createdAt' | 'status'>): ImprovementProposal {
    return this.append('improvement-proposals', { ...p, proposalId: newId('prop'), createdAt: new Date().toISOString(), status: 'PROPOSED' });
  }
  /** 承認前は適用しない。承認時のみRuleVersionを更新（approvedBy必須・二重承認拒否） */
  approveProposal(proposalId: string, approvedBy: string, rule: { ruleId: string; name: string; body: string; rollbackNote: string; companyId: string }): RuleVersion {
    const hit = [...this.load<ImprovementProposal>('improvement-proposals')].reverse().find((p) => p.proposalId === proposalId);
    if (!hit) throw new Error('提案が見つかりません');
    if (!approvedBy) throw new Error('承認者なしでRuleVersionは更新できません');
    if (hit.status !== 'PROPOSED') throw new Error(`この提案は既に${hit.status}です（同一Proposalの二重承認は拒否）`);
    this.append('improvement-proposals', { ...hit, status: 'APPROVED' });
    const prev = [...this.load<RuleVersion>('rule-versions')].reverse().find((r) => r.ruleId === rule.ruleId) ?? null;
    return this.append('rule-versions', {
      ruleId: rule.ruleId, companyId: rule.companyId, name: rule.name,
      currentVersion: (prev?.currentVersion ?? 0) + 1,
      body: rule.body, previousBody: prev?.body ?? null,
      appliedAt: new Date().toISOString(), rollbackNote: rule.rollbackNote, approvedBy
    });
  }
  proposals(): ImprovementProposal[] {
    const byId = new Map<string, ImprovementProposal>();
    for (const p of this.load<ImprovementProposal>('improvement-proposals')) byId.set(p.proposalId, p);
    return [...byId.values()];
  }
  ruleVersions(): RuleVersion[] { return [...this.load<RuleVersion>('rule-versions')]; }
  currentRule(ruleId: string): RuleVersion | null {
    return [...this.load<RuleVersion>('rule-versions')].reverse().find((r) => r.ruleId === ruleId) ?? null;
  }
}
