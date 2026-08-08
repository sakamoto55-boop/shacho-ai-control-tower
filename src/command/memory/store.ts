/**
 * MemoryService — Persistent Memoryの保存・訂正・検索・重複/矛盾検知。
 *
 * Learning Safety（絶対禁止事項）をここで強制する:
 * - AIの推測をFACTとして保存しない（AI起源のFACTは根拠必須、なければHYPOTHESIS化かエラー）
 * - 古い記憶を履歴なしで上書きしない（SUPERSEDED/CORRECTEDで履歴保持）
 * - 出典なしの重要Memory（FACT/DECISION）を保存しない
 * - 高機密内容を一般Memoryへ複製しない（SENSITIVE_REFは参照のみ）
 * - 外部Web情報を社内事実として保存しない（EXTERNAL層へ強制）
 * - DECISION等の監査必須履歴は削除不可（Archiveのみ、物理削除なし）
 */
import type { Principal } from '../domain/types.js';
import type { ExperimentRecord, MemoryQuery, MemoryRecord, MemoryStatus } from './types.js';

export class LearningSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearningSafetyError';
  }
}

let memorySeq = 0;
export function resetMemorySeq(): void {
  memorySeq = 0;
}
function newMemoryId(now: string): string {
  return `mem-${now.slice(0, 10)}-${memorySeq++}`;
}

/** 給与・口座・個人情報等が実値で書かれていないか（SENSITIVE_REF強制の判定） */
export function containsSensitiveContent(statement: string): boolean {
  return [
    /(月給|年収|給与|日給|時給|基本給|賞与)[^。]{0,10}[0-9,，万]+円?/,
    /口座番号|振込先.{0,6}\d{4,}/,
    /マイナンバー|個人番号/,
    /(診断|病名|通院|障害等級)/,
    /人事評価.{0,10}(S|A|B|C|D)評価/
  ].some((pattern) => pattern.test(statement));
}

function normalize(text: string): string {
  return text
    .replace(/[\s、。「」『』（）()？！?!.,]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/** 文字bigramのJaccard類似度（Vector DBなしのSemantic近似） */
export function similarity(a: string, b: string): number {
  const bigrams = (text: string) => {
    const normalized = normalize(text);
    const set = new Set<string>();
    for (let i = 0; i < normalized.length - 1; i += 1) set.add(normalized.slice(i, i + 2));
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const gram of setA) if (setB.has(gram)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

export interface MemoryBackend {
  getMemories(): Promise<MemoryRecord[]>;
  saveMemory(record: MemoryRecord): Promise<MemoryRecord>;
  getExperiments(): Promise<ExperimentRecord[]>;
  saveExperiment(record: ExperimentRecord): Promise<ExperimentRecord>;
}

export interface SaveResult {
  record: MemoryRecord;
  /** 既存と同内容のためEvidence追記で済ませた場合true */
  mergedIntoExisting: boolean;
  /** 同一対象で矛盾するACTIVE記憶（勝手に上書きせず報告する） */
  conflictsWith: MemoryRecord[];
}

export type NewMemoryInput = Omit<
  MemoryRecord,
  'memoryId' | 'createdAt' | 'updatedAt' | 'status' | 'supersededBy'
> & { status?: MemoryStatus };

export class MemoryService {
  constructor(private readonly backend: MemoryBackend) {}

  private validate(input: NewMemoryInput): void {
    const aiCreated = input.createdBy.startsWith('ai');
    if (input.type === 'FACT' && aiCreated && input.evidence.length === 0) {
      throw new LearningSafetyError(
        'AIの推測をFACTとして保存できません。根拠を付けるかHYPOTHESISとして保存してください'
      );
    }
    if (
      (input.type === 'FACT' || input.type === 'DECISION') &&
      input.evidence.length === 0 &&
      !input.sourceId
    ) {
      throw new LearningSafetyError(
        `出典のない${input.type}は保存できません（source/evidence必須）`
      );
    }
    if (input.type === 'DECISION' && aiCreated && input.reviewStatus !== 'PENDING_REVIEW') {
      throw new LearningSafetyError('AIは正式Decisionを独断で確定できません（PENDING_REVIEW必須）');
    }
    if (input.sensitivity === 'NORMAL' && containsSensitiveContent(input.statement)) {
      throw new LearningSafetyError(
        '高機密情報（給与・口座・個人情報等）は一般Memoryへ複製できません。SENSITIVE_REFとして参照のみ保存してください'
      );
    }
    if (input.sensitivity === 'SENSITIVE_REF' && containsSensitiveContent(input.statement)) {
      throw new LearningSafetyError(
        'SENSITIVE_REFのstatementに実値を含めないでください（参照情報のみ）'
      );
    }
  }

  async save(input: NewMemoryInput, now: string): Promise<SaveResult> {
    this.validate(input);
    const record: MemoryRecord = {
      ...input,
      // 外部調査由来は社内事実の層に入れない
      layer: input.source === 'EXTERNAL_RESEARCH' ? 'EXTERNAL' : input.layer,
      memoryId: newMemoryId(now),
      createdAt: now,
      updatedAt: now,
      status: input.status ?? 'ACTIVE'
    };

    const existing = (await this.backend.getMemories()).filter(
      (m) => m.status === 'ACTIVE' && m.companyId === record.companyId
    );

    // Deduplication: 同型・高類似はEvidence追記に留める
    const duplicate = existing.find(
      (m) => m.type === record.type && similarity(m.statement, record.statement) >= 0.6
    );
    if (duplicate) {
      duplicate.evidence = [...duplicate.evidence, ...record.evidence].slice(0, 20);
      duplicate.updatedAt = now;
      await this.backend.saveMemory(duplicate);
      return { record: duplicate, mergedIntoExisting: true, conflictsWith: [] };
    }

    // Conflict: 同一対象（subjectKey）で内容が異なる → 上書きせず両方保持して報告
    const conflicts = record.subjectKey
      ? existing.filter(
          (m) =>
            m.subjectKey === record.subjectKey && similarity(m.statement, record.statement) < 0.6
        )
      : [];
    if (conflicts.length > 0) {
      record.relations = [
        ...record.relations,
        ...conflicts.map((m) => ({ kind: 'conflictsWith' as const, targetMemoryId: m.memoryId }))
      ];
    }
    await this.backend.saveMemory(record);
    return { record, mergedIntoExisting: false, conflictsWith: conflicts };
  }

  /** User Correction: 履歴を失わず旧記憶を閉じ、新記憶へつなぐ */
  async correct(
    oldMemoryId: string,
    replacement: NewMemoryInput,
    now: string,
    note: string,
    mode: 'CORRECTED' | 'SUPERSEDED' = 'CORRECTED'
  ): Promise<{ old: MemoryRecord; replacement: MemoryRecord }> {
    const memories = await this.backend.getMemories();
    const old = memories.find((m) => m.memoryId === oldMemoryId);
    if (!old) throw new Error(`memory not found: ${oldMemoryId}`);
    const saved = await this.save(
      { ...replacement, supersedes: old.memoryId, validFrom: now },
      now
    );
    old.status = mode;
    old.supersededBy = saved.record.memoryId;
    old.validUntil = now.slice(0, 10);
    old.correctionNote = note;
    old.updatedAt = now;
    await this.backend.saveMemory(old);
    return { old, replacement: saved.record };
  }

  /** 置換なしの訂正（「それ違う」のみで新情報未提供の場合）。履歴は保持する */
  async invalidate(memoryId: string, now: string, note: string): Promise<MemoryRecord> {
    const memories = await this.backend.getMemories();
    const memory = memories.find((m) => m.memoryId === memoryId);
    if (!memory) throw new Error(`memory not found: ${memoryId}`);
    memory.status = 'CORRECTED';
    memory.validUntil = now.slice(0, 10);
    memory.correctionNote = note;
    memory.updatedAt = now;
    return this.backend.saveMemory(memory);
  }

  /** Conflict解決: ユーザー判断で片方を正とし、他方をSUPERSEDEDにする */
  async resolveConflict(
    keepId: string,
    supersedeId: string,
    now: string,
    note: string
  ): Promise<void> {
    const memories = await this.backend.getMemories();
    const loser = memories.find((m) => m.memoryId === supersedeId);
    if (!loser) throw new Error(`memory not found: ${supersedeId}`);
    loser.status = 'SUPERSEDED';
    loser.supersededBy = keepId;
    loser.validUntil = now.slice(0, 10);
    loser.correctionNote = note;
    loser.updatedAt = now;
    await this.backend.saveMemory(loser);
  }

  /** Archive: 監査上必要なDECISION履歴は物理削除しない（状態変更のみ） */
  async archive(memoryId: string, now: string): Promise<MemoryRecord> {
    const memories = await this.backend.getMemories();
    const memory = memories.find((m) => m.memoryId === memoryId);
    if (!memory) throw new Error(`memory not found: ${memoryId}`);
    memory.status = 'ARCHIVED';
    memory.updatedAt = now;
    return this.backend.saveMemory(memory);
  }

  /** RBAC + 層分離を強制した検索。PRESIDENT層はPRESIDENT/SYSTEMのみ */
  async search(query: MemoryQuery, principal: Principal): Promise<MemoryRecord[]> {
    const all = await this.backend.getMemories();
    const canPresident = principal.role === 'PRESIDENT' || principal.role === 'SYSTEM';
    const canSensitive = canPresident || principal.role === 'EXECUTIVE';
    const terms = query.q ? normalize(query.q) : null;

    return all
      .filter((m) => {
        if (m.layer === 'PRESIDENT' && !canPresident) return false;
        if (m.sensitivity === 'SENSITIVE_REF' && !canSensitive) return false;
        if (
          principal.companyIds.length > 0 &&
          !principal.companyIds.includes(m.companyId) &&
          !canPresident
        )
          return false;
        if (query.companyId && m.companyId !== query.companyId) return false;
        if (query.type && m.type !== query.type) return false;
        if (query.layer && m.layer !== query.layer) return false;
        if (query.projectId && m.projectId !== query.projectId) return false;
        if (
          query.entityName &&
          !m.entities.some((e) => e.name.includes(query.entityName as string))
        )
          return false;
        if (query.validAt) {
          // Temporal Retrieval: その時点で有効だった記憶（後に置換されたものも含む）
          if (m.validFrom > query.validAt) return false;
          if (m.validUntil && m.validUntil < query.validAt.slice(0, 10)) return false;
          if (!['ACTIVE', 'SUPERSEDED', 'CORRECTED', 'EXPIRED'].includes(m.status)) return false;
        } else if (!query.includeInactive && m.status !== 'ACTIVE') {
          return false;
        }
        if (terms) {
          const haystack = normalize(`${m.statement} ${m.entities.map((e) => e.name).join(' ')}`);
          const tokens = (query.q as string)
            .split(/[\s、。,・]+/)
            .map((t) => normalize(t))
            .filter((t) => t.length >= 2);
          const tokenHit = tokens.some((t) => haystack.includes(t));
          const score = similarity(query.q as string, m.statement);
          if (!haystack.includes(terms) && !tokenHit && score < 0.15) return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, query.limit ?? 10);
  }

  /** 記憶の変遷（いつ・なぜ変えたか）を時系列で返す */
  async history(memoryId: string): Promise<MemoryRecord[]> {
    const all = await this.backend.getMemories();
    const chain: MemoryRecord[] = [];
    let current = all.find((m) => m.memoryId === memoryId);
    // 先頭（最古）まで遡る
    while (current?.supersedes) {
      const prev = all.find((m) => m.memoryId === current?.supersedes);
      if (!prev) break;
      current = prev;
    }
    while (current) {
      chain.push(current);
      current = all.find((m) => m.memoryId === current?.supersededBy);
    }
    return chain;
  }
}
