/**
 * Growth Backlog / Priority / Constitution Guard / Goal Alignment（Phase GROWTH §30-§34）。
 *
 * 改善候補（COMPANY/AI/DATA）をBacklogとして正本管理する。
 * - すべての候補はCompany Constitutionと照合される（§30。反する案はREVISE注記）
 * - Target Registryと照合し、目標に紐づかない改善は優先度を下げる（§31）
 * - AIから社長への提案は上位のみ（§34。毎日大量に出さない）
 */
import type { Evidence, Principal } from '../domain/types.js';
import type { CommandRepository } from '../repositories/CommandRepository.js';
import { ConstitutionService } from '../constitution/constitutionRegistry.js';
import { TargetRegistryService } from '../targets/targetRegistry.js';
import type { GrowthDomain } from './growthEngine.js';

export type GrowthStatus =
  | 'NEW'
  | 'RESEARCHING'
  | 'PROPOSED'
  | 'APPROVED'
  | 'EXPERIMENTING'
  | 'MEASURING'
  | 'LEARNED'
  | 'REJECTED';

export type GrowthRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface GrowthCandidate {
  kind: 'CANDIDATE';
  candidateId: string;
  domain: GrowthDomain;
  title: string;
  problem: string;
  source: 'OBSERVATION' | 'PATTERN' | 'CONVERSATION' | 'FUTURE' | 'ARTIFACT_FEEDBACK' | 'SELF_EVAL';
  status: GrowthStatus;
  risk: GrowthRisk;
  /** 優先度スコアの内訳（§32。総合点だけで判断しない） */
  priority: {
    impact: number;
    urgency: number;
    confidence: number;
    effort: number;
    risk: number;
    goalAlignment: number;
    score: number;
  };
  constitutionWarnings: string[];
  goalAlignmentNote: string;
  evidence: Evidence[];
  createdAt: string;
  updatedAt: string;
  /** 同じ失敗案を繰り返し提案しないための参照（§17） */
  relatedLessonIds: string[];
}

/** 自己改善Registry（§28）。Promotion Pipeline（§27）で管理 */
export type ImprovementTarget = 'PROMPT' | 'ROUTER' | 'CODE' | 'CONSTITUTION' | 'SAFETY_RULE' | 'RBAC';
export type ImprovementStatus = 'PROPOSED' | 'TESTED' | 'REVIEWED' | 'APPROVED' | 'ACTIVE' | 'REJECTED';

export interface ImprovementCandidate {
  kind: 'IMPROVEMENT';
  improvementId: string;
  target: ImprovementTarget;
  currentVersion: string;
  candidateVersion: string;
  reason: string;
  evidence: Evidence[];
  evaluation?: string;
  risk: GrowthRisk;
  status: ImprovementStatus;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Data Repair Candidate（§19）。Source of Truthは変更せず修正候補のみ */
export interface RepairCandidate {
  kind: 'REPAIR';
  repairId: string;
  issueKind: string;
  description: string;
  proposedFix: string;
  confidencePct: number;
  evidence: Evidence[];
  status: 'PROPOSED' | 'CONFIRMED' | 'REJECTED';
  confirmedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** 現場名⇔案件ID等のMapping学習（§20）。人間の確認結果のみ蓄積 */
export interface MappingRecord {
  kind: 'MAPPING';
  mappingId: string;
  sourceText: string;
  targetId: string;
  confirmations: number;
  confirmedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type GrowthItem = GrowthCandidate | ImprovementCandidate | RepairCandidate | MappingRecord;

let growthSeq = 0;
export function resetGrowthSeq(): void {
  growthSeq = 0;
}
function nextId(prefix: string): string {
  growthSeq += 1;
  return `${prefix}-${String(growthSeq).padStart(3, '0')}`;
}

/** 優先度スコア（§32）。0-1の各軸を重み付け（内訳は必ず保持） */
export function scorePriority(input: {
  impact: number;
  urgency: number;
  confidence: number;
  effort: number;
  risk: number;
  goalAlignment: number;
}): GrowthCandidate['priority'] {
  const score =
    input.impact * 0.3 +
    input.urgency * 0.15 +
    input.confidence * 0.15 +
    (1 - input.effort) * 0.1 +
    (1 - input.risk) * 0.1 +
    input.goalAlignment * 0.2;
  return { ...input, score: Math.round(score * 1000) / 1000 };
}

export class GrowthService {
  private readonly constitution: ConstitutionService;
  private readonly targets: TargetRegistryService;

  constructor(private readonly repository: CommandRepository) {
    this.constitution = new ConstitutionService(repository);
    this.targets = new TargetRegistryService(repository);
  }

  async list(): Promise<GrowthItem[]> {
    return this.repository.getGrowthItems();
  }

  async backlog(): Promise<GrowthCandidate[]> {
    return (await this.list()).filter((i): i is GrowthCandidate => i.kind === 'CANDIDATE');
  }

  /**
   * 改善候補の登録。Constitution Guard（§30）とGoal Alignment（§31）をここで強制する。
   */
  async addCandidate(
    input: Omit<
      GrowthCandidate,
      'kind' | 'candidateId' | 'status' | 'priority' | 'constitutionWarnings' | 'goalAlignmentNote' | 'createdAt' | 'updatedAt' | 'relatedLessonIds'
    > & { priorityInput: Parameters<typeof scorePriority>[0] },
    now: string
  ): Promise<GrowthCandidate> {
    const constitutionHits = await this.constitution.checkProposal(`${input.title} ${input.problem}`);
    const activeTargets = await this.targets.activeTargets(now);
    const aligned = activeTargets.length > 0;
    const priorityInput = { ...input.priorityInput };
    if (!aligned) priorityInput.goalAlignment = Math.min(priorityInput.goalAlignment, 0.3);

    // §17: 過去のFAILURE Lessonと同種の案は再提案しない（関連Lessonを記録し優先度を下げる）
    const memories = await this.repository.getMemories();
    const failedLessons = memories.filter(
      (m) =>
        m.type === 'LESSON' &&
        m.status === 'ACTIVE' &&
        /FAILURE|効果がなかった|失敗/.test(m.statement) &&
        (m.statement.match(/[一-龠ァ-ヶー]{3,}/g) ?? []).some((t) => `${input.title}${input.problem}`.includes(t))
    );
    if (failedLessons.length > 0) priorityInput.confidence = Math.min(priorityInput.confidence, 0.3);

    const candidate: GrowthCandidate = {
      kind: 'CANDIDATE',
      candidateId: nextId('grw'),
      domain: input.domain,
      title: input.title,
      problem: input.problem,
      source: input.source,
      status: 'NEW',
      risk: input.risk,
      priority: scorePriority(priorityInput),
      constitutionWarnings: constitutionHits.map((h) => h.warning),
      goalAlignmentNote: aligned
        ? `ACTIVE目標${activeTargets.length}件と照合済み`
        : '正式承認済みの目標がないため整合性UNKNOWN（優先度を保守的に評価）',
      evidence: input.evidence,
      createdAt: now,
      updatedAt: now,
      relatedLessonIds: failedLessons.map((m) => m.memoryId)
    };
    await this.repository.saveGrowthItem(candidate);
    return candidate;
  }

  async updateCandidateStatus(candidateId: string, status: GrowthStatus, now: string): Promise<GrowthCandidate | null> {
    const items = await this.list();
    const candidate = items.find((i): i is GrowthCandidate => i.kind === 'CANDIDATE' && i.candidateId === candidateId);
    if (!candidate) return null;
    const updated = { ...candidate, status, updatedAt: now };
    await this.repository.saveGrowthItem(updated);
    return updated;
  }

  /** §34: 社長への提案は経営インパクト上位のみ */
  async topProposals(limit = 2): Promise<GrowthCandidate[]> {
    const backlog = await this.backlog();
    return backlog
      .filter((c) => c.status === 'NEW' || c.status === 'PROPOSED')
      .sort((a, b) => b.priority.score - a.priority.score)
      .slice(0, limit);
  }

  // ---- Data Repair（§19）----
  async addRepairCandidate(
    input: Omit<RepairCandidate, 'kind' | 'repairId' | 'status' | 'createdAt' | 'updatedAt'>,
    now: string
  ): Promise<RepairCandidate> {
    const repair: RepairCandidate = {
      kind: 'REPAIR',
      repairId: nextId('rep'),
      status: 'PROPOSED',
      createdAt: now,
      updatedAt: now,
      ...input
    };
    await this.repository.saveGrowthItem(repair);
    return repair;
  }

  /** 人間確認（承認ルール）。AIはSource of Truthを直接修正しない */
  async confirmRepair(repairId: string, principal: Principal, now: string): Promise<RepairCandidate | null> {
    const items = await this.list();
    const repair = items.find((i): i is RepairCandidate => i.kind === 'REPAIR' && i.repairId === repairId);
    if (!repair) return null;
    const updated: RepairCandidate = { ...repair, status: 'CONFIRMED', confirmedBy: principal.label, updatedAt: now };
    await this.repository.saveGrowthItem(updated);
    return updated;
  }

  // ---- Mapping学習（§20）----
  async learnMapping(sourceText: string, targetId: string, principal: Principal, now: string): Promise<MappingRecord> {
    const items = await this.list();
    const existing = items.find(
      (i): i is MappingRecord => i.kind === 'MAPPING' && i.sourceText === sourceText && i.targetId === targetId
    );
    if (existing) {
      const updated = { ...existing, confirmations: existing.confirmations + 1, updatedAt: now };
      await this.repository.saveGrowthItem(updated);
      return updated;
    }
    const record: MappingRecord = {
      kind: 'MAPPING',
      mappingId: nextId('map'),
      sourceText,
      targetId,
      confirmations: 1,
      confirmedBy: principal.label,
      createdAt: now,
      updatedAt: now
    };
    await this.repository.saveGrowthItem(record);
    return record;
  }

  /** Mapping候補の提示（確認回数で確度を上げる。Source IDは変更しない） */
  async suggestMapping(sourceText: string): Promise<{ targetId: string; confidencePct: number } | null> {
    const items = await this.list();
    const matches = items.filter(
      (i): i is MappingRecord => i.kind === 'MAPPING' && i.sourceText === sourceText
    );
    if (matches.length === 0) return null;
    const best = matches.sort((a, b) => b.confirmations - a.confirmations)[0];
    return { targetId: best.targetId, confidencePct: Math.min(60 + best.confirmations * 15, 95) };
  }
}
