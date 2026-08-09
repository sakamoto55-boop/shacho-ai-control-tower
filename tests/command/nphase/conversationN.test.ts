import { beforeEach, describe, expect, it } from 'vitest';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';
import { resetMemorySeq } from '../../../src/command/memory/store.js';
import { resetPlanSeq } from '../../../src/command/agents/rolePlanner.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('N: §41 連続会話（役割統合・検証・記憶操作）', () => {
  let repository: InMemoryCommandRepository;
  let orchestrator: CommandOrchestrator;
  const S = 'n41';

  const chat = (message: string) =>
    orchestrator.chat({ message, scope: 'lcc', asOf: ASOF, sessionId: S });

  beforeEach(() => {
    resetToolIdSeq();
    resetMemorySeq();
    resetPlanSeq();
    repository = new InMemoryCommandRepository();
    orchestrator = new CommandOrchestrator(repository);
  });

  it('§41の長い連続会話が最後まで成立する', async () => {
    expect((await chat('今月どう？')).text).toContain('着地予測');
    expect((await chat('その中で一番危ないのは？')).text).toContain('A案件');
    expect((await chat('なんで？')).text).toContain('【主因】');
    expect((await chat('根拠見せて')).text).toContain('直前の回答の根拠');
    expect((await chat('本当に？')).text).toContain('Data Confidence');

    const alt = await chat('別の見方は？');
    expect(alt.text).toContain('Devil');
    expect(alt.text).toContain('回答を書き換えません');

    expect((await chat('じゃあどうする？')).text).toContain('【AIの提案】');

    const bold = await chat('もっと大胆に考えて');
    expect(bold.text).toMatch(/10倍|制約を外した/);
    expect(bold.text).toContain('First Principles');

    const risk = await chat('その案のリスクは？');
    expect(risk.text).toContain('リスク');

    const similar = await chat('前に似たことなかった？');
    expect(similar.text.length).toBeGreaterThan(0); // 記憶なしなら正直に「見つからない」

    const result = await chat('結果どうだった？');
    expect(result.text).toMatch(/実験|登録されていません/);

    // 記憶操作: 覚える → 取り消す
    expect((await chat('低粗利案件は受注前に社長確認する、を覚えておいて')).text).toContain(
      '覚えました'
    );
    expect((await chat('いや、今のなし')).text).toContain('取り消しました');

    // 決定候補 → 正式方針化 → 影響確認
    await chat('低粗利案件は受注前に社長確認することにした');
    const promoted = await chat('さっきのを正式方針にする');
    expect(promoted.text).toContain('正式方針として確定しました');
    const memories = await repository.getMemories();
    const decision = memories.find((m) => m.type === 'DECISION' && m.confidence === 'CONFIRMED');
    expect(decision).toBeDefined();

    const impact = await chat('それで影響するところある？');
    expect(impact.text.length).toBeGreaterThan(0);

    const research = await chat('調べる必要あるなら調べて');
    expect(research.text).toContain('外部調査');
  });

  it('複数Role質問はPlan経由で統合回答になり、内部Role名はユーザーへ露出しない（§30）', async () => {
    const res = await chat(
      'この新規事業をやるべきか、競合と市場も調べて、収益モデルと実行計画を作って'
    );
    expect(res.text).toContain('【結論】');
    expect(res.text).toContain('【リスク】');
    // 内部用語の非露出
    expect(res.text).not.toContain('FACT_LOOKUP');
    expect(res.text).not.toContain('SYNTHESIS');
    expect(res.text).not.toContain('providerId');
    // Observability（内部データとして保持）
    const data = res.data as { trace: unknown[]; taskCount: number };
    expect(data.taskCount).toBeGreaterThanOrEqual(4);
    expect(data.trace.length).toBe(data.taskCount);
    // 外部調査タスクが実際に発行されている
    const store = await repository.getStore();
    expect(store.research.length).toBe(1);
  });

  it('「徹底的に」でDEEP Budgetになり、通常質問は単独処理のまま（Cost Guardrail）', async () => {
    const deep = await chat('新市場参入を徹底的に調べて評価して');
    const deepData = deep.data as { budget: string };
    expect(deepData.budget).toBe('DEEP');

    const normal = await chat('今月どう？');
    expect((normal.data as { budget?: string })?.budget).toBeUndefined(); // Plan非経由
  });

  it('単価訂正で影響範囲の報告と確認質問（AI→User Question）が返る', async () => {
    await chat('出雲不動産の処分単価は据え置き、を覚えておいて');
    const corrected = await chat('それ違う。今は出雲不動産の処分単価は引き上げ後の新単価');
    expect(corrected.text).toContain('記憶を更新しました');
    expect(corrected.text).toContain('影響する可能性');
    expect(corrected.text).toContain('正式決定ですか'); // Clarification質問
    expect(corrected.text).toContain('【選択肢】');
    expect(corrected.text).toContain('【推奨】');
  });

  it('Critic系の追い質問は回答を書き換えず検証結果のみ返す', async () => {
    await chat('今月どう？');
    const res = await chat('間違いない？');
    expect(res.text).toContain('検証');
    expect(res.toolsUsed).toContain('critic');
  });
});
