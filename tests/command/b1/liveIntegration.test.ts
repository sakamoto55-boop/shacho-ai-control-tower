import { beforeEach, describe, expect, it } from 'vitest';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { createCommandApp } from '../../../src/command/server/routes.js';
import { ObservabilityLog } from '../../../src/command/observability/observability.js';
import { evaluateSanity } from '../../../src/command/sources/sanity.js';
import { reviewAnswerWithAdvisor } from '../../../src/command/agents/critic.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';
import { resetMemorySeq } from '../../../src/command/memory/store.js';
import { resetPlanSeq } from '../../../src/command/agents/rolePlanner.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('B1: Live Integration（学習サマリー・LLMフック・Observability・サニティ）', () => {
  let repository: InMemoryCommandRepository;

  beforeEach(() => {
    resetToolIdSeq();
    resetMemorySeq();
    resetPlanSeq();
    repository = new InMemoryCommandRepository();
  });

  const chat = (orchestrator: CommandOrchestrator, message: string) =>
    orchestrator.chat({ message, scope: 'lcc', asOf: ASOF, sessionId: 'b1' });

  it('「今日何を覚えた？」がDaily Learning Summaryを返す', async () => {
    const orchestrator = new CommandOrchestrator(repository);
    await chat(orchestrator, '低粗利案件は受注前に社長確認する、を覚えておいて');
    const res = await chat(orchestrator, '今日何を覚えた？');
    expect(res.text).toContain('今日の学習サマリー');
    expect(res.text).toContain('低粗利案件');
  });

  it('記憶がない日は正直に「まだない」と返す', async () => {
    const orchestrator = new CommandOrchestrator(repository);
    const res = await chat(orchestrator, '今日何を覚えた？');
    expect(res.text).toContain('まだ新しく覚えたことはありません');
  });

  it('朝Briefに【今日AIが学んだこと】が載る（§14）', async () => {
    const orchestrator = new CommandOrchestrator(repository);
    await chat(orchestrator, '低粗利案件は受注前に社長確認する、を覚えておいて');
    const res = await chat(orchestrator, 'おはよう');
    expect(res.text).toContain('【今日AIが学んだこと】');
    expect(res.text).toContain('低粗利案件');
  });

  it('LLM Curator v2: LLM候補のFACTはHYPOTHESISへ格下げ・DECISIONは確認待ちになる', async () => {
    const orchestrator = new CommandOrchestrator(repository, {
      curatorExtractor: async () => [
        { type: 'FACT', statement: '出雲エリアの処分単価は上昇傾向にある' },
        { type: 'DECISION', statement: '新規外注先は相見積を必須とする' }
      ]
    });
    await chat(orchestrator, '外注費の傾向について所感を共有しておく');
    const memories = await repository.getMemories();
    const hypothesis = memories.find((m) => m.statement.includes('処分単価は上昇傾向'));
    expect(hypothesis?.type).toBe('HYPOTHESIS');
    expect(hypothesis?.confidence).toBe('UNVERIFIED');
    const decision = memories.find((m) => m.statement.includes('相見積を必須'));
    expect(decision?.type).toBe('DECISION');
    expect(decision?.reviewStatus).toBe('PENDING_REVIEW');
  });

  it('LLM Curator v2: 給与など機微情報の候補はLearning Safetyが保存を拒否する', async () => {
    const orchestrator = new CommandOrchestrator(repository, {
      curatorExtractor: async () => [{ type: 'FACT', statement: '社員Aの月給は30万円である' }]
    });
    await chat(orchestrator, '今日の共有事項');
    const memories = await repository.getMemories();
    expect(memories.some((m) => m.statement.includes('30万円'))).toBe(false);
  });

  it('Critic v2: LLM指摘は追加のみで、決定論検査の指摘は消えない', async () => {
    const draft = {
      text: '当月売上は18,000,000円です。',
      evidence: [],
      confidence: 'HIGH' as const
    };
    const withAdvisor = await reviewAnswerWithAdvisor(draft, [], async () => [
      { issue: '前年同月比が示されていない', severity: 'LOW', recommendation: '比較値を添える' }
    ]);
    expect(withAdvisor.issues.some((i) => i.issue.includes('根拠'))).toBe(true); // 決定論の指摘
    expect(withAdvisor.issues.some((i) => i.issue.includes('前年同月比'))).toBe(true); // LLM追加

    const advisorFails = await reviewAnswerWithAdvisor(draft, [], async () => {
      throw new Error('llm down');
    });
    expect(advisorFails.issues.some((i) => i.issue.includes('根拠'))).toBe(true);
  });

  it('Observability: 会話メタデータのみ記録され、会話本文は保存されない', async () => {
    const observability = new ObservabilityLog('');
    const orchestrator = new CommandOrchestrator(repository, { observability });
    await chat(orchestrator, '今月どう？');
    const entries = observability.recent(10, 'chat');
    expect(entries.length).toBe(1);
    expect(entries[0].intent).toBe('sales');
    expect(JSON.stringify(entries[0])).not.toContain('今月どう');
  });

  it('POST /feedback がObservabilityへ保存される（自動学習には使わない旨を返す）', async () => {
    const observability = new ObservabilityLog('');
    const app = createCommandApp({ repository, observabilityLog: observability, llmHooks: {} });
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 'good', sessionId: 'b1', intent: 'sales' })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; note: string };
    expect(body.ok).toBe(true);
    expect(body.note).toContain('自動学習には使いません');
    expect(observability.recent(10, 'feedback').length).toBe(1);

    const bad = await app.request('/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 'invalid' })
    });
    expect(bad.status).toBe(400);
  });

  it('GET /observability が記録と概算コストを返す', async () => {
    const observability = new ObservabilityLog('');
    const app = createCommandApp({ repository, observabilityLog: observability, llmHooks: {} });
    await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '今月どう？', scope: 'lcc', asOf: ASOF })
    });
    const res = await app.request('/observability?limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[]; totalApproxTokens: number };
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.totalApproxTokens).toBe(0);
  });

  it('サニティチェック: 部分取込（111/2268）はNOT READY、全量一致はREADY', async () => {
    const partial = evaluateSanity([
      { name: 'customers', expected: 2268, actual: 111 },
      { name: 'projects', expected: 2459, actual: 45 }
    ]);
    expect(partial.ready).toBe(false);
    expect(partial.failures.length).toBe(2);
    expect(partial.lines.join('\n')).toContain('NOT READY');

    const full = evaluateSanity([
      { name: 'customers', expected: 2268, actual: 2268 },
      { name: 'projects', expected: 2459, actual: 2400 } // 2.4%乖離は許容内
    ]);
    expect(full.ready).toBe(true);

    expect(evaluateSanity([]).ready).toBe(false); // 照合対象なしはREADYにしない
  });
});
