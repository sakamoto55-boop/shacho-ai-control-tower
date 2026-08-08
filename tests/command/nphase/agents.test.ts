import { beforeEach, describe, expect, it } from 'vitest';
import {
  assessInput,
  buildPlan,
  resetPlanSeq,
  BUDGET_LIMITS
} from '../../../src/command/agents/rolePlanner.js';
import {
  ProviderRegistry,
  createDefaultRegistry
} from '../../../src/command/agents/providerRegistry.js';
import {
  shouldRunCritic,
  reviewAnswer,
  devilsAdvocate
} from '../../../src/command/agents/critic.js';
import { AgentTraceLog, PlanExecutor } from '../../../src/command/agents/executor.js';
import { analyzeCorrectionImpact } from '../../../src/command/agents/correctionImpact.js';
import { ROLES } from '../../../src/command/agents/roles.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { MemoryService, resetMemorySeq } from '../../../src/command/memory/store.js';
import { GeneralReasoner, createGeneralRouter } from '../../../src/command/ai/generalReasoner.js';
import { buildSeedDataset } from '../../../src/command/data/seed.js';
import { classifyConstraint } from '../../../src/command/memory/innovation.js';
import { rankInsights } from '../../../src/command/memory/maintenance.js';
import type { MemoryRecord } from '../../../src/command/memory/types.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('N: Role Router / Task Plan / Cost Guardrail', () => {
  beforeEach(() => resetPlanSeq());

  it('入力を多面的に評価する（Intent/Risk/Depth/機密/緊急度）', () => {
    const a = assessInput(
      'この新規事業をやるべきか、競合と市場も調べて、収益モデルと実行計画を作って'
    );
    expect(a.risk).toBe('HIGH');
    expect(a.externalDataNeed).toBe(true);
    expect(a.reasoningDepth).toBe('DEEP');
    expect(a.categories.length).toBeGreaterThanOrEqual(2);
    const b = assessInput('田中の給与について至急');
    expect(b.confidentiality).toBe('SENSITIVE');
    expect(b.urgency).toBe('URGENT');
  });

  it('戦略×調査の質問は複数Role Plan（並列→統合→CRITIC→SYNTHESIS）になる', () => {
    const message = 'この新規事業をやるべきか、競合と市場も調べて、収益モデルと実行計画を作って';
    const plan = buildPlan(message, assessInput(message))!;
    expect(plan).not.toBeNull();
    const roles = plan.tasks.map((t) => t.role);
    expect(roles).toContain('RESEARCH');
    expect(roles).toContain('STRATEGY');
    expect(roles).toContain('CRITIC'); // risk HIGH
    expect(roles).toContain('SYNTHESIS');
    expect(plan.parallelizable).toBe(true);
    // 依存のないTaskが並列フェーズを構成する
    expect(plan.tasks.filter((t) => t.dependsOn.length === 0).length).toBeGreaterThanOrEqual(2);
  });

  it('通常会話はPlanを作らない（Cost Guardrail: 単独処理）', () => {
    for (const message of ['今月どう？', '現金大丈夫？', '請求漏れてない？', 'こんにちは']) {
      expect(buildPlan(message, assessInput(message))).toBeNull();
    }
  });

  it('「徹底的に」でExecution BudgetがDEEPへ上がる（§35）', () => {
    const normal = assessInput('競合を調べて');
    const deep = assessInput('競合を徹底的に調べて');
    expect(deep.budget).toBe('DEEP');
    expect(BUDGET_LIMITS[deep.budget].maxAgents).toBeGreaterThan(BUDGET_LIMITS.LOW.maxAgents);
    expect(BUDGET_LIMITS[normal.budget].maxResearchTasks).toBeLessThanOrEqual(
      BUDGET_LIMITS[deep.budget].maxResearchTasks
    );
  });
});

describe('N: Provider Registry / Fallback / Data Policy', () => {
  it('Roleにモデルを固定せずCapability Scoreで選ぶ。未設定Providerがあっても停止しない', () => {
    const registry = createDefaultRegistry({}); // APIキーなし環境
    expect(registry.list().length).toBeGreaterThanOrEqual(4); // manus等も登録はされている
    const selection = registry.select(
      ROLES.ANALYSIS.requiredCapabilities,
      ROLES.ANALYSIS.preferredProviders,
      ROLES.ANALYSIS.fallbackProviders
    );
    expect(selection.provider?.providerId).toBe('deterministic'); // anthropic不在でも決定論で動く
  });

  it('障害実績はHistorical Success Rateとして選択に反映される', () => {
    const registry = createDefaultRegistry({});
    registry.recordOutcome('deterministic', true);
    registry.recordOutcome('deterministic', true);
    expect(registry.successRate('deterministic')).toBe(1);
    registry.recordOutcome('deterministic', false);
    expect(registry.successRate('deterministic')).toBeCloseTo(2 / 3, 5);
  });

  it('Data Policy: 機微データを渡せないProviderへは切り替えず説明を返す', () => {
    const registry = new ProviderRegistry();
    registry.register({
      providerId: 'external-llm',
      vendor: 'Other',
      model: 'x',
      capabilities: ['reasoning'],
      costClass: 'LOW',
      latencyClass: 'FAST',
      contextWindow: 1000,
      toolCalling: false,
      structuredOutput: false,
      webResearch: false,
      longRunning: false,
      vision: false,
      audio: false,
      reliability: 0.9,
      allowsSensitiveData: false,
      available: true
    });
    const selection = registry.select(['reasoning'], ['external-llm'], [], {
      needsSensitive: true
    });
    expect(selection.provider).toBeNull();
    expect(selection.policyBlock).toContain('Data Policy');
  });
});

describe('N: Critic / Devil’s Advocate', () => {
  const baseAssessment = assessInput('今月どう？');

  it('起動条件: 通常質問では起動せず、高リスク・検証要求・矛盾で起動する（§10）', () => {
    const noCtx = { conflictingMemories: false, multiAgent: false, lowConfidenceEvidence: false };
    expect(shouldRunCritic('今月どう？', baseAssessment, noCtx)).toBe(false);
    expect(shouldRunCritic('本当に？', baseAssessment, noCtx)).toBe(true);
    expect(shouldRunCritic('反対意見は？', baseAssessment, noCtx)).toBe(true);
    expect(shouldRunCritic('この買収やるべきか', assessInput('この買収やるべきか'), noCtx)).toBe(
      true
    );
    expect(
      shouldRunCritic('今月どう？', baseAssessment, { ...noCtx, conflictingMemories: true })
    ).toBe(true);
    expect(shouldRunCritic('今月どう？', baseAssessment, { ...noCtx, multiAgent: true })).toBe(
      true
    );
  });

  it('検証は答えを変更せずissues[]を返す（根拠なし数値・推測混在・Decision矛盾）', () => {
    const decisions: MemoryRecord[] = [
      {
        memoryId: 'm1',
        type: 'DECISION',
        statement: '公共工事は主要チャネルとしない',
        entities: [],
        relations: [],
        layer: 'PRESIDENT',
        sensitivity: 'NORMAL',
        companyId: 'lcc',
        source: 'CONVERSATION',
        createdAt: ASOF,
        updatedAt: ASOF,
        validFrom: '2026-01-01',
        confidence: 'CONFIRMED',
        status: 'ACTIVE',
        createdBy: 'user:社長',
        reviewStatus: 'CONFIRMED_BY_USER',
        evidence: []
      }
    ];
    const draft = {
      text: '公共工事へ本格参入すべきです。売上は10,000,000円増える可能性があります。【推奨】即実行。',
      evidence: [],
      confidence: 'MEDIUM' as const
    };
    const result = reviewAnswer(draft, decisions);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
    expect(result.issues.some((i) => i.issue.includes('根拠'))).toBe(true);
    expect(result.issues.some((i) => i.issue.includes('矛盾'))).toBe(true);
    expect(result.issues.every((i) => i.recommendation.length > 0)).toBe(true);
  });

  it('Devil’s Advocate: 賛成案への反対論点を構造的に出す', () => {
    const counters = devilsAdvocate('新規事業を始めたい', ['粗利が低下している']);
    expect(counters.some((c) => c.includes('機会費用'))).toBe(true);
    expect(counters.some((c) => c.includes('撤退'))).toBe(true);
    expect(counters.some((c) => c.includes('既存課題'))).toBe(true);
  });
});

describe('N: Plan Executor（並列・Privacy Boundary・Observability）', () => {
  beforeEach(() => {
    resetPlanSeq();
    resetMemorySeq();
  });

  it('Planを実行しSYNTHESIS形式（結論→事実→リスク→別案→推奨→次）で統合。Traceを記録する', async () => {
    const repository = new InMemoryCommandRepository();
    const service = new MemoryService(repository);
    const trace = new AgentTraceLog();
    const executor = new PlanExecutor(
      createDefaultRegistry({}),
      service,
      new GeneralReasoner(createGeneralRouter({})),
      trace
    );
    const message = 'この新規事業をやるべきか、競合と市場も調べて、収益モデルと実行計画を作って';
    const plan = buildPlan(message, assessInput(message))!;
    const ctx = {
      dataset: buildSeedDataset(ASOF),
      store: await repository.getStore(),
      repository,
      scope: 'lcc' as const
    };
    const outcome = await executor.execute(
      plan,
      ctx,
      { role: 'PRESIDENT', companyIds: [], label: '社長' },
      false
    );

    expect(outcome.planStatus).toBe('DONE');
    for (const section of [
      '【結論】',
      '【確認できた事実】',
      '【リスク】',
      '【別案】',
      '【推奨】',
      '【次にやること】'
    ]) {
      expect(outcome.synthesisText).toContain(section);
    }
    // 反対意見（CRITIC facts）が統合されている
    expect(outcome.synthesisText).toContain('反対意見');
    // Observability: Plan/Role/Provider/latency/成否が記録されている
    const entries = trace.forPlan(plan.planId);
    expect(entries.length).toBe(plan.tasks.length);
    expect(entries.every((e) => e.providerId.length > 0 && e.latencyMs >= 0)).toBe(true);
    // Privacy Boundary: RESEARCH Taskへ社内要約を渡していない（構造上facts空入力）
    const research = outcome.results.find((r) => r.role === 'RESEARCH')!;
    expect(research.facts.join('')).not.toContain('現預金');
  });
});

describe('N: Correction Impact Engine', () => {
  it('単価訂正の影響範囲（案件・見積・指標）と確認質問を返す', () => {
    const dataset = buildSeedDataset(ASOF);
    const corrected: MemoryRecord = {
      memoryId: 'mem-x',
      type: 'FACT',
      statement: '出雲不動産の処分単価が先月から変わっている',
      entities: [{ entityType: 'Customer', entityId: 'cust-izumo', name: '出雲不動産株式会社' }],
      relations: [],
      layer: 'COMPANY',
      sensitivity: 'NORMAL',
      companyId: 'lcc',
      source: 'CONVERSATION',
      createdAt: ASOF,
      updatedAt: ASOF,
      validFrom: '2026-08-08',
      confidence: 'HIGH',
      status: 'CORRECTED',
      createdBy: 'user:社長',
      reviewStatus: 'CONFIRMED_BY_USER',
      evidence: []
    };
    const impact = analyzeCorrectionImpact(dataset, corrected, '新単価に更新', []);
    // 出雲不動産の進行中案件（prj-a等）が影響候補に挙がる
    expect(impact.affectedProjects.some((p) => p.projectId === 'prj-a')).toBe(true);
    expect(impact.affectedMetrics).toContain('予測粗利率');
    // AI→User確認質問（Active Clarification構造）
    expect(impact.clarification).toBeDefined();
    expect(impact.clarification!.question).toContain('正式決定ですか');
    expect(impact.clarification!.options.length).toBeGreaterThanOrEqual(2);
    expect(impact.clarification!.recommendation.length).toBeGreaterThan(0);
  });
});

describe('N: Innovation v2 / Insight Ranking', () => {
  it('制約をREAL/POLICY/HABIT/ASSUMPTIONへ分類する（法令は勝手に無視しない）', () => {
    expect(classifyConstraint('解体には許可と資格が必要')).toBe('REAL');
    expect(classifyConstraint('社内ルールで二重チェックすることになっている')).toBe('POLICY');
    expect(classifyConstraint('昔からずっとこのやり方でやっている')).toBe('HABIT');
    expect(classifyConstraint('たぶん客が嫌がると思う')).toBe('ASSUMPTION');
  });

  it('Insight RankingはImpact/Urgency/Confidence/Actionabilityで低価値を捨てる', () => {
    const ranked = rankInsights([
      '低粗利案件3件のうち3件で処分費超過が共通しています。単価設定の問題として再分析する価値があります。',
      'なんとなく気になる点があります'
    ]);
    expect(ranked.length).toBe(1);
    expect(ranked[0].text).toContain('処分費');
    expect(ranked[0].score).toBeGreaterThanOrEqual(0.5);
  });
});
