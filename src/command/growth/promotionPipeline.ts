import { randomUUID as persistentUuid } from 'node:crypto';
/**
 * Self-Improvement Promotion Pipeline（Phase GROWTH §24-§29・§46）。
 *
 * AIは本番Prompt・Router・Code・Constitution・Safety Ruleを直接変更しない（§27）。
 * すべて PROPOSED → TESTED → REVIEWED → APPROVED → ACTIVE のPipelineを通す。
 * - APPROVED→ACTIVEは人間承認（approvedBy）必須
 * - §46のSafety Gate対象（Constitution/Safety Rule/RBAC）はこのPipelineでACTIVE化できない
 *   （別Gate＝PRESIDENT承認フローのみ。Growth実装のために勝手にACTIVE化しない §48）
 */
import type { CommandRepository } from '../repositories/CommandRepository.js';
import type { CommandModelProvider } from '../ai/ModelRouter.js';
import type { GrowthRisk, ImprovementCandidate, ImprovementStatus, ImprovementTarget } from './growthBacklog.js';
import type { Evidence } from '../domain/types.js';

const ORDER: ImprovementStatus[] = ['PROPOSED', 'TESTED', 'REVIEWED', 'APPROVED', 'ACTIVE'];

/** §46: Growth Pipelineから自動変更してはならない対象 */
export const SAFETY_GATED_TARGETS: ImprovementTarget[] = ['CONSTITUTION', 'SAFETY_RULE', 'RBAC'];

let improvementSeq = 0;
export function resetImprovementSeq(): void {
  improvementSeq = 0;
}

export class PromotionPipeline {
  constructor(private readonly repository: CommandRepository) {}

  async propose(
    input: {
      target: ImprovementTarget;
      currentVersion: string;
      candidateVersion: string;
      reason: string;
      evidence: Evidence[];
      risk: GrowthRisk;
    },
    now: string
  ): Promise<ImprovementCandidate> {
    improvementSeq += 1;
    const candidate: ImprovementCandidate = {
      kind: 'IMPROVEMENT',
      improvementId: `imp-${String(improvementSeq).padStart(3, '0')}-${persistentUuid()}`,
      status: 'PROPOSED',
      createdAt: now,
      updatedAt: now,
      ...input
    };
    await this.repository.saveGrowthItem(candidate);
    return candidate;
  }

  async advance(
    improvementId: string,
    now: string,
    options: { approvedBy?: string; evaluation?: string } = {}
  ): Promise<ImprovementCandidate> {
    const items = await this.repository.getGrowthItems();
    const candidate = items.find(
      (i): i is ImprovementCandidate => i.kind === 'IMPROVEMENT' && i.improvementId === improvementId
    );
    if (!candidate) throw new Error(`Improvement ${improvementId} が見つかりません`);
    const index = ORDER.indexOf(candidate.status);
    if (index < 0 || candidate.status === 'ACTIVE') return candidate;
    const next = ORDER[index + 1];
    if (next === 'ACTIVE') {
      if (SAFETY_GATED_TARGETS.includes(candidate.target)) {
        throw new Error(
          `対象「${candidate.target}」はGrowth PipelineからACTIVE化できません（Safety Gate §46。Constitution/Safety/RBACは別の承認Gateを通してください）`
        );
      }
      if (!options.approvedBy) {
        throw new Error('ACTIVE化には人間の承認（approvedBy）が必須です。AIによる自己改変は禁止されています');
      }
    }
    const updated: ImprovementCandidate = {
      ...candidate,
      status: next,
      approvedBy: options.approvedBy ?? candidate.approvedBy,
      evaluation: options.evaluation ?? candidate.evaluation,
      updatedAt: now
    };
    await this.repository.saveGrowthItem(updated);
    return updated;
  }

  async reject(improvementId: string, now: string, reason: string): Promise<ImprovementCandidate> {
    const items = await this.repository.getGrowthItems();
    const candidate = items.find(
      (i): i is ImprovementCandidate => i.kind === 'IMPROVEMENT' && i.improvementId === improvementId
    );
    if (!candidate) throw new Error(`Improvement ${improvementId} が見つかりません`);
    const updated: ImprovementCandidate = {
      ...candidate,
      status: 'REJECTED',
      evaluation: reason,
      updatedAt: now
    };
    await this.repository.saveGrowthItem(updated);
    return updated;
  }
}

/**
 * Prompt A/B評価（§26）。Current vs Candidate を同一Evaluation質問で比較する。
 * 判定は決定論（期待語の含有・長さ・エラー率）。本番反映はPipelineの承認後のみ。
 */
export interface PromptAbResult {
  question: string;
  currentOk: boolean;
  candidateOk: boolean;
}

export async function evaluatePromptCandidate(
  provider: CommandModelProvider,
  currentPrompt: string,
  candidatePrompt: string,
  questions: Array<{ question: string; expectText: string[] }>
): Promise<{ results: PromptAbResult[]; currentScore: number; candidateScore: number; recommendation: string }> {
  const results: PromptAbResult[] = [];
  for (const q of questions) {
    const run = async (systemPrompt: string): Promise<boolean> => {
      try {
        const answer = await provider.complete({ purpose: 'analysis', systemPrompt, userMessage: q.question });
        return q.expectText.every((t) => answer.includes(t));
      } catch {
        return false;
      }
    };
    results.push({
      question: q.question,
      currentOk: await run(currentPrompt),
      candidateOk: await run(candidatePrompt)
    });
  }
  const currentScore = results.filter((r) => r.currentOk).length / Math.max(results.length, 1);
  const candidateScore = results.filter((r) => r.candidateOk).length / Math.max(results.length, 1);
  return {
    results,
    currentScore,
    candidateScore,
    recommendation:
      candidateScore > currentScore
        ? '候補Promptが上回りました（Pipelineの承認後に反映可能）'
        : candidateScore < currentScore
          ? '現行Promptを維持することを推奨します'
          : '有意差なし（サンプル追加を推奨）'
  };
}
