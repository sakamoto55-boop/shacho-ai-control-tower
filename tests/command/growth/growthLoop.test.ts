/**
 * Phase GROWTH — Autonomous Growth Loop のテスト。
 *
 * 検証の柱:
 * - 観測・変化検知・パターン検知は決定論（§3-§5）
 * - 改善候補はConstitution Guard / Goal Alignment / 失敗Lesson照合を通る（§17・§30-§31）
 * - 自己改変禁止: Promotion PipelineのACTIVE化は人間承認必須、
 *   Constitution/Safety/RBACはPipelineからACTIVE化できない（§27-§28・§46）
 * - 測定データがなければ「効果測定できていません」（§41。改善を偽らない）
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';
import { resetMemorySeq } from '../../../src/command/memory/store.js';
import { resetPlanSeq } from '../../../src/command/agents/rolePlanner.js';
import {
  buildRootCauseCandidates,
  detectChanges,
  detectPatterns,
  evaluateExperimentResult,
  takeSnapshot,
  type GrowthSnapshot
} from '../../../src/command/growth/growthEngine.js';
import {
  GrowthService,
  resetGrowthSeq,
  scorePriority
} from '../../../src/command/growth/growthBacklog.js';
import {
  PromotionPipeline,
  evaluatePromptCandidate,
  resetImprovementSeq
} from '../../../src/command/growth/promotionPipeline.js';
import { computeSelfEvaluation } from '../../../src/command/growth/selfEvaluation.js';
import {
  buildDailyGrowthReview,
  buildMonthlyIntelligenceReview,
  buildWeeklyGrowthReview,
  type GrowthReviewInput
} from '../../../src/command/growth/growthReview.js';
import { buildExperiment, completeExperiment } from '../../../src/command/memory/maintenance.js';
import { buildSeedDataset } from '../../../src/command/data/seed.js';
import type { MemoryRecord } from '../../../src/command/memory/types.js';
import type { ObservabilityEntry } from '../../../src/command/observability/observability.js';
import type { Principal } from '../../../src/command/domain/types.js';

const ASOF = '2026-08-08T00:00:00.000Z';
const PRESIDENT: Principal = { role: 'PRESIDENT', companyIds: [], label: 'test-president' };

function lessonRecord(memoryId: string, statement: string): MemoryRecord {
  return {
    memoryId,
    type: 'LESSON',
    statement,
    entities: [],
    relations: [],
    layer: 'COMPANY',
    sensitivity: 'INTERNAL',
    companyId: 'lcc',
    source: 'SYSTEM',
    createdAt: ASOF,
    updatedAt: ASOF,
    validFrom: ASOF,
    confidence: 'MEDIUM',
    status: 'ACTIVE',
    createdBy: 'ai:experiment',
    reviewStatus: 'AUTO',
    evidence: []
  };
}

describe('Growth Engine（§3-§6: 観測・変化検知・Pattern・Root Cause）', () => {
  it('スナップショットは決定論で、同一データセットなら同一値になる', () => {
    const dataset = buildSeedDataset(ASOF);
    const a = takeSnapshot(dataset, 'group');
    const b = takeSnapshot(buildSeedDataset(ASOF), 'group');
    expect(a).toEqual(b);
    expect(a.salesLanding).toBeGreaterThan(0);
    expect(a.takenAt).toBe(ASOF);
  });

  it('変化検知は「前回からの変化」を返し、悪化と改善を区別する（§4）', () => {
    const dataset = buildSeedDataset(ASOF);
    const previous = takeSnapshot(dataset, 'group');
    const worsened: GrowthSnapshot = {
      ...previous,
      marginForecastPct: previous.marginForecastPct - 2,
      leakCount: previous.leakCount + 2,
      uninvoicedTotal: previous.uninvoicedTotal + 1_000_000
    };
    const signals = detectChanges(previous, worsened);
    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain('MARGIN_WORSENED');
    expect(kinds).toContain('LEAKS_INCREASED');
    expect(kinds).toContain('UNINVOICED_INCREASED');
    for (const signal of signals) {
      expect(signal.evidence[0].value).toContain('前回');
      expect(signal.evidence[0].value).toContain('今回');
    }
    // 改善方向
    const improvedSignals = detectChanges(worsened, previous);
    expect(improvedSignals.some((s) => s.kind === 'IMPROVED' && !s.negative)).toBe(true);
  });

  it('同一シグナルが閾値（3回）以上でPatternになる（§5。単発異常と区別）', () => {
    const dataset = buildSeedDataset(ASOF);
    const base = takeSnapshot(dataset, 'group');
    const bad: GrowthSnapshot = { ...base, leakCount: base.leakCount + 1 };
    const signals = detectChanges(base, bad);
    const twice = detectPatterns([
      { takenAt: '2026-08-06', signals },
      { takenAt: '2026-08-07', signals }
    ]);
    expect(twice).toHaveLength(0); // 2回では単発扱い
    const thrice = detectPatterns([
      { takenAt: '2026-08-06', signals },
      { takenAt: '2026-08-07', signals },
      { takenAt: '2026-08-08', signals }
    ]);
    expect(thrice.some((p) => p.kind === 'LEAKS_INCREASED' && p.occurrences === 3)).toBe(true);
  });

  it('Root CauseはHYPOTHESIS（確信度LOW）として返り、FACT化されない（§6）', () => {
    const dataset = buildSeedDataset(ASOF);
    const base = takeSnapshot(dataset, 'group');
    const signals = detectChanges(base, { ...base, marginForecastPct: base.marginForecastPct - 2 });
    const cause = buildRootCauseCandidates(dataset, 'group', signals[0]);
    expect(cause.confidence).toBe('LOW');
    expect(cause.possibleCauses.length).toBeGreaterThan(0);
  });

  it('実験評価: 実施しただけでは成功にならない（§13-§15）', () => {
    expect(evaluateExperimentResult(10, 4, 5, { lowerIsBetter: true }).verdict).toBe('SUCCESS');
    expect(evaluateExperimentResult(10, 8, 5, { lowerIsBetter: true }).verdict).toBe('INCONCLUSIVE');
    expect(evaluateExperimentResult(10, 12, 5, { lowerIsBetter: true }).verdict).toBe('FAILURE');
    expect(evaluateExperimentResult(100, 130, 120).verdict).toBe('SUCCESS');
  });
});

describe('Growth Backlog（§17・§30-§34: Guard・優先度・上位のみ提案）', () => {
  let repository: InMemoryCommandRepository;
  let service: GrowthService;

  beforeEach(() => {
    resetGrowthSeq();
    resetMemorySeq();
    repository = new InMemoryCommandRepository();
    service = new GrowthService(repository);
  });

  it('優先度スコアは内訳を必ず保持する（§32。総合点だけにしない）', () => {
    const priority = scorePriority({
      impact: 0.8,
      urgency: 0.6,
      confidence: 0.5,
      effort: 0.4,
      risk: 0.2,
      goalAlignment: 0.7
    });
    expect(priority.impact).toBe(0.8);
    expect(priority.goalAlignment).toBe(0.7);
    expect(priority.score).toBeGreaterThan(0);
    expect(priority.score).toBeLessThanOrEqual(1);
  });

  it('Constitution Guard: 原則に反する候補は警告付きで登録される（§30）', async () => {
    const candidate = await service.addCandidate(
      {
        domain: 'COMPANY',
        title: '案件情報の新しい入力台帳を作る',
        problem: '入力が遅い',
        source: 'OBSERVATION',
        risk: 'LOW',
        evidence: [],
        priorityInput: { impact: 0.5, urgency: 0.5, confidence: 0.5, effort: 0.3, risk: 0.2, goalAlignment: 0.8 }
      },
      ASOF
    );
    expect(candidate.constitutionWarnings.length).toBeGreaterThan(0);
    expect(candidate.constitutionWarnings[0]).toContain('反する可能性');
  });

  it('正式目標がない間はGoal Alignmentを保守的に評価する（§31）', async () => {
    const candidate = await service.addCandidate(
      {
        domain: 'COMPANY',
        title: '見積の提出リードタイム短縮',
        problem: '見積が遅い',
        source: 'OBSERVATION',
        risk: 'LOW',
        evidence: [],
        priorityInput: { impact: 0.6, urgency: 0.5, confidence: 0.6, effort: 0.3, risk: 0.2, goalAlignment: 0.9 }
      },
      ASOF
    );
    expect(candidate.priority.goalAlignment).toBeLessThanOrEqual(0.3);
    expect(candidate.goalAlignmentNote).toContain('UNKNOWN');
  });

  it('過去に失敗したLessonと同種の案は確信度を下げて登録する（§17）', async () => {
    await repository.saveMemory(
      lessonRecord('mem-fail-1', '実験「値引きキャンペーンで受注増」の結果: 失敗（粗利悪化・効果がなかった）')
    );
    const candidate = await service.addCandidate(
      {
        domain: 'COMPANY',
        title: '値引きキャンペーンの再実施',
        problem: '受注が伸びない',
        source: 'CONVERSATION',
        risk: 'MEDIUM',
        evidence: [],
        priorityInput: { impact: 0.7, urgency: 0.6, confidence: 0.9, effort: 0.4, risk: 0.4, goalAlignment: 0.5 }
      },
      ASOF
    );
    expect(candidate.priority.confidence).toBeLessThanOrEqual(0.3);
    expect(candidate.relatedLessonIds).toContain('mem-fail-1');
  });

  it('社長への提案は優先度上位のみ（§34: topProposals(2)）', async () => {
    for (const [index, impact] of [0.2, 0.9, 0.5, 0.7].entries()) {
      await service.addCandidate(
        {
          domain: 'COMPANY',
          title: `改善候補${index}`,
          problem: `問題${index}`,
          source: 'OBSERVATION',
          risk: 'LOW',
          evidence: [],
          priorityInput: { impact, urgency: 0.5, confidence: 0.5, effort: 0.3, risk: 0.2, goalAlignment: 0.3 }
        },
        ASOF
      );
    }
    const top = await service.topProposals(2);
    expect(top).toHaveLength(2);
    expect(top[0].priority.score).toBeGreaterThanOrEqual(top[1].priority.score);
    expect(top[0].title).toBe('改善候補1');
  });

  it('Data Repair: AIは修正候補のみ・確定は人間（§19）', async () => {
    const repair = await service.addRepairCandidate(
      {
        issueKind: 'DATE_INVALID',
        description: 'prj_2001の完工日が着工日より前',
        proposedFix: '完工日を2026-07-31へ修正（過去パターンからの候補）',
        confidencePct: 80,
        evidence: []
      },
      ASOF
    );
    expect(repair.status).toBe('PROPOSED');
    const confirmed = await service.confirmRepair(repair.repairId, PRESIDENT, ASOF);
    expect(confirmed?.status).toBe('CONFIRMED');
    expect(confirmed?.confirmedBy).toBe('test-president');
    // Source of Truth（データセット）は変更されない
    const dataset = await repository.getDataset(ASOF);
    expect(dataset.projects.length).toBeGreaterThan(0);
  });

  it('Mapping学習: 人間確認の回数で確度が上がる（§20。95%上限）', async () => {
    await service.learnMapping('一成建設', 'prj_2001', PRESIDENT, ASOF);
    const first = await service.suggestMapping('一成建設');
    expect(first?.targetId).toBe('prj_2001');
    expect(first?.confidencePct).toBe(75);
    await service.learnMapping('一成建設', 'prj_2001', PRESIDENT, ASOF);
    const second = await service.suggestMapping('一成建設');
    expect(second?.confidencePct).toBe(90);
    for (let i = 0; i < 5; i += 1) await service.learnMapping('一成建設', 'prj_2001', PRESIDENT, ASOF);
    const capped = await service.suggestMapping('一成建設');
    expect(capped?.confidencePct).toBe(95);
    expect(await service.suggestMapping('未知の現場')).toBeNull();
  });
});

describe('Promotion Pipeline（§24-§29・§46: 自己改変禁止）', () => {
  let repository: InMemoryCommandRepository;
  let pipeline: PromotionPipeline;

  beforeEach(() => {
    resetImprovementSeq();
    repository = new InMemoryCommandRepository();
    pipeline = new PromotionPipeline(repository);
  });

  it('PROPOSED→TESTED→REVIEWED→APPROVEDの順に進み、ACTIVE化は人間承認必須（§27-§28）', async () => {
    const proposed = await pipeline.propose(
      {
        target: 'PROMPT',
        currentVersion: 'v1',
        candidateVersion: 'v2',
        reason: 'UNKNOWN率が高い質問カテゴリの改善',
        evidence: [],
        risk: 'LOW'
      },
      ASOF
    );
    expect(proposed.status).toBe('PROPOSED');
    const tested = await pipeline.advance(proposed.improvementId, ASOF, { evaluation: 'A/B 8/10 vs 6/10' });
    expect(tested.status).toBe('TESTED');
    const reviewed = await pipeline.advance(proposed.improvementId, ASOF);
    expect(reviewed.status).toBe('REVIEWED');
    const approved = await pipeline.advance(proposed.improvementId, ASOF);
    expect(approved.status).toBe('APPROVED');
    // 承認者なしのACTIVE化は拒否＝AIの自己改変禁止
    await expect(pipeline.advance(proposed.improvementId, ASOF)).rejects.toThrow('自己改変は禁止');
    const active = await pipeline.advance(proposed.improvementId, ASOF, { approvedBy: '社長' });
    expect(active.status).toBe('ACTIVE');
    expect(active.approvedBy).toBe('社長');
  });

  it('Safety Gate対象（CONSTITUTION/SAFETY_RULE/RBAC）はPipelineからACTIVE化できない（§46）', async () => {
    for (const target of ['CONSTITUTION', 'SAFETY_RULE', 'RBAC'] as const) {
      const candidate = await pipeline.propose(
        {
          target,
          currentVersion: 'v1',
          candidateVersion: 'v2',
          reason: 'test',
          evidence: [],
          risk: 'CRITICAL'
        },
        ASOF
      );
      await pipeline.advance(candidate.improvementId, ASOF); // TESTED
      await pipeline.advance(candidate.improvementId, ASOF); // REVIEWED
      await pipeline.advance(candidate.improvementId, ASOF); // APPROVED
      await expect(
        pipeline.advance(candidate.improvementId, ASOF, { approvedBy: '社長' })
      ).rejects.toThrow('Safety Gate');
    }
  });

  it('Prompt A/B評価は決定論判定で、勝者を推奨するだけ（§26。本番反映しない）', async () => {
    const provider = {
      providerId: 'fake',
      complete: async ({ systemPrompt, userMessage }: { systemPrompt?: string; userMessage: string }) =>
        systemPrompt === 'candidate' ? `${userMessage}: 根拠付き回答` : '曖昧な回答'
    };
    const result = await evaluatePromptCandidate(provider, 'current', 'candidate', [
      { question: '今月どう？', expectText: ['根拠'] },
      { question: '現金大丈夫？', expectText: ['根拠'] }
    ]);
    expect(result.candidateScore).toBe(1);
    expect(result.currentScore).toBe(0);
    expect(result.recommendation).toContain('承認後に反映可能');
  });
});

describe('AI Self-Evaluation（§21-§22・§41）', () => {
  it('サンプルゼロなら「効果測定できていません」と正直に返す（§41）', () => {
    const evaluation = computeSelfEvaluation([], []);
    expect(evaluation.sampleSize).toBe(0);
    expect(evaluation.compositeScore).toBeNull();
    expect(evaluation.note).toContain('効果測定できていません');
  });

  it('サンプル20件未満では総合点を出さない（§22。少数への過適合防止）', () => {
    const chats: ObservabilityEntry[] = Array.from({ length: 5 }, (_, i) => ({
      timestamp: ASOF,
      kind: 'chat',
      confidence: i % 2 === 0 ? 'HIGH' : 'UNKNOWN',
      durationMs: 100
    }));
    const evaluation = computeSelfEvaluation(chats, []);
    expect(evaluation.sampleSize).toBe(5);
    expect(evaluation.compositeScore).toBeNull();
    expect(evaluation.metrics.highConfidenceRate).toBeGreaterThan(0);
  });

  it('20件以上で総合点を内訳とセットで算出し、Provider別実績も保持する（§23）', () => {
    const chats: ObservabilityEntry[] = Array.from({ length: 25 }, () => ({
      timestamp: ASOF,
      kind: 'chat',
      confidence: 'HIGH',
      durationMs: 120
    }));
    const evaluation = computeSelfEvaluation(chats, [
      { taskId: 't1', role: 'ANALYSIS', providerId: 'anthropic', startedAt: ASOF, latencyMs: 200, success: true },
      { taskId: 't2', role: 'ANALYSIS', providerId: 'anthropic', startedAt: ASOF, latencyMs: 300, success: false }
    ] as never);
    expect(evaluation.compositeScore).not.toBeNull();
    expect(evaluation.perProvider[0].providerId).toBe('anthropic');
    expect(evaluation.perProvider[0].successRate).toBe(0.5);
    expect(evaluation.note).toContain('内訳');
  });
});

describe('Growth Review（§34-§37・§40-§41）', () => {
  const emptyInput = (): GrowthReviewInput => ({
    signals: [],
    patterns: [],
    backlog: [],
    repairs: [],
    experiments: [],
    lessons: [],
    selfEvaluation: computeSelfEvaluation([], [])
  });

  it('Daily: 異常なしを正直に報告する（§35）', () => {
    const text = buildDailyGrowthReview(emptyInput());
    expect(text).toContain('Daily Growth Review');
    expect(text).toContain('新しい異常はありません');
  });

  it('Weekly: 改善候補は上位2件のみ報告する（§34・§36）', async () => {
    resetGrowthSeq();
    const repository = new InMemoryCommandRepository();
    const service = new GrowthService(repository);
    for (const impact of [0.9, 0.7, 0.5, 0.3]) {
      await service.addCandidate(
        {
          domain: 'COMPANY',
          title: `候補impact${impact}`,
          problem: '問題',
          source: 'OBSERVATION',
          risk: 'LOW',
          evidence: [],
          priorityInput: { impact, urgency: 0.5, confidence: 0.5, effort: 0.3, risk: 0.2, goalAlignment: 0.3 }
        },
        ASOF
      );
    }
    const text = buildWeeklyGrowthReview({ ...emptyInput(), backlog: await service.backlog() });
    expect(text).toContain('上位2件のみ報告します');
    expect(text).toContain('候補impact0.9');
    expect(text).toContain('候補impact0.7');
    expect(text).not.toContain('候補impact0.3');
  });

  it('Monthly: 測定データがなければ改善を主張しない（§40-§41）', () => {
    const text = buildMonthlyIntelligenceReview(emptyInput());
    expect(text).toContain('効果測定できていません');
    expect(text).not.toContain('改善しました');
  });
});

describe('Orchestrator Growth会話（§39・§43）', () => {
  let repository: InMemoryCommandRepository;
  let orchestrator: CommandOrchestrator;

  beforeEach(() => {
    resetToolIdSeq();
    resetMemorySeq();
    resetPlanSeq();
    resetGrowthSeq();
    repository = new InMemoryCommandRepository();
    orchestrator = new CommandOrchestrator(repository);
  });

  const chat = (message: string) =>
    orchestrator.chat({ message, scope: 'group', asOf: ASOF, sessionId: 'growth' });

  it('「会社で何が改善した？」— 測定なしでは「効果測定できていません」（§41）', async () => {
    const response = await chat('会社で何が改善した？');
    expect(response.text).toContain('効果測定できていません');
    expect(response.confidence).toBe('UNKNOWN');
  });

  it('「会社で何が改善した？」— SUCCESS測定済み実験があればEvidence付きで報告（§40）', async () => {
    const experiment = buildExperiment(
      { companyId: 'lcc', hypothesis: '見積テンプレ導入で提出日数短縮', metric: '平均提出日数', baseline: '5日', target: '3日' },
      'test',
      ASOF
    );
    completeExperiment(experiment, '2.5日', 'SUCCESS（目標3日を達成）', ASOF);
    await repository.saveExperiment(experiment);
    const response = await chat('会社で何が改善した？');
    expect(response.text).toContain('測定データで確認できた改善');
    expect(response.text).toContain('5日 → 2.5日');
    expect(response.evidence.length).toBeGreaterThan(0);
  });

  it('「AI自身は賢くなった？」— サンプルなしでは正直に測定不能と答える（§21・§41）', async () => {
    const response = await chat('AI自身は賢くなった？');
    expect(response.text).toContain('効果測定できていません');
    expect(response.text).toContain('自己申告はしません');
  });

  it('「失敗した施策は？」— 記録なしを正直に、記録があれば削除せず提示（§16-§17）', async () => {
    const before = await chat('失敗した施策は？');
    expect(before.text).toContain('失敗として記録された施策はまだありません');

    const experiment = buildExperiment(
      { companyId: 'lcc', hypothesis: '値引きで受注増', metric: '月間受注', baseline: '10件', target: '15件' },
      'test',
      ASOF
    );
    completeExperiment(experiment, '9件', 'FAILURE（受注減・粗利悪化）', ASOF);
    await repository.saveExperiment(experiment);
    const after = await chat('失敗した施策は？');
    expect(after.text).toContain('失敗・未達として記録');
    expect(after.text).toContain('値引きで受注増');
  });

  it('「次に何を改善すべき？」— Backlogが空なら正直に、あれば上位のみ提案（§34・§39）', async () => {
    const empty = await chat('次に何を改善すべき？');
    expect(empty.text).toContain('提案待ちの改善候補はまだありません');

    const service = new GrowthService(repository);
    await service.addCandidate(
      {
        domain: 'DATA',
        title: '完工未請求の起票リードタイム短縮',
        problem: '完工から請求までが遅い',
        source: 'OBSERVATION',
        risk: 'LOW',
        evidence: [],
        priorityInput: { impact: 0.8, urgency: 0.7, confidence: 0.6, effort: 0.3, risk: 0.1, goalAlignment: 0.5 }
      },
      ASOF
    );
    const proposed = await chat('次に何を改善すべき？');
    expect(proposed.text).toContain('次の改善提案');
    expect(proposed.text).toContain('完工未請求の起票リードタイム短縮');
    expect(proposed.text).toContain('内訳');
    expect(proposed.text).toContain('社長の判断');
  });

  it('「最近AIは何を学んだ？」も学習サマリーへ届く（§39）', async () => {
    const response = await chat('最近AIは何を学んだ？');
    expect(response.text).toMatch(/学習サマリー|覚えたことはありません/);
  });

  it('§43: 会話で語られた課題はGrowth Backlogへ候補として蓄積される', async () => {
    await chat('現場写真の共有が遅いのが課題');
    const service = new GrowthService(repository);
    const backlog = await service.backlog();
    expect(backlog.length).toBeGreaterThan(0);
    expect(backlog[0].source).toBe('CONVERSATION');
    expect(backlog[0].problem).toContain('課題');
  });
});
