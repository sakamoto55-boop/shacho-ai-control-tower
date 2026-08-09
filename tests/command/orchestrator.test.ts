import { beforeEach, describe, expect, it } from 'vitest';
import { CommandOrchestrator } from '../../src/command/orchestrator/orchestrator.js';
import { InMemoryCommandRepository } from '../../src/command/repositories/CommandRepository.js';
import { resetToolIdSeq } from '../../src/command/tools/registry.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('Orchestrator（会話中心UX）', () => {
  let repository: InMemoryCommandRepository;
  let orchestrator: CommandOrchestrator;

  beforeEach(() => {
    resetToolIdSeq();
    repository = new InMemoryCommandRepository();
    orchestrator = new CommandOrchestrator(repository);
  });

  it('「今月どう？」に確定売上・着地予測・不足額を根拠付きで答える', async () => {
    const response = await orchestrator.chat({ message: '今月どう？', scope: 'lcc', asOf: ASOF });
    expect(response.text).toContain('【確認できた事実】');
    expect(response.text).toContain('18,000,000円');
    expect(response.text).toContain('23,225,000円');
    expect(response.text).toContain('-7.1%');
    expect(response.uiHint).toBe('chart');
    expect(response.confidence).toBe('HIGH');
    expect(response.evidence.length).toBeGreaterThan(0);
    expect(response.toolsUsed).toContain('get_sales_summary');
  });

  it('「現金大丈夫？」に残高と7/30/60/90日予測を答える', async () => {
    const response = await orchestrator.chat({ message: '現金大丈夫？', asOf: ASOF });
    expect(response.text).toContain('17,500,000円'); // グループ全体
    expect(response.text).toContain('30日後');
    expect(response.uiHint).toBe('cash_table');
  });

  it('法人スコープを指定すると混在しない', async () => {
    const response = await orchestrator.chat({ message: '現金大丈夫？', scope: 'wel', asOf: ASOF });
    expect(response.text).toContain('2,000,000円');
    expect(response.text).not.toContain('17,500,000円');
  });

  it('「A案件なぜ利益悪い？」に事実・主因・推測・推奨を分離して答える', async () => {
    const response = await orchestrator.chat({
      message: 'A案件なぜ利益悪い？',
      scope: 'lcc',
      asOf: ASOF
    });
    expect(response.text).toContain('【確認できた事実】');
    expect(response.text).toContain('24.8%');
    expect(response.text).toContain('【主因】');
    expect(response.text).toContain('外注費が見積比＋800,000円');
    expect(response.text).toContain('【AIの推測】');
    expect(response.text).toContain('【推奨】');
    expect(response.uiHint).toBe('project_card');
  });

  it('シナリオ質問「入金が15日遅れたら？」を再計算する', async () => {
    const response = await orchestrator.chat({
      message: '大野建設の入金が15日遅れたら？',
      scope: 'lcc',
      asOf: ASOF
    });
    expect(response.text).toContain('【計算結果】');
    expect(response.text).toContain('12,400,000円 → 2,400,000円');
  });

  it('「最終接点は？」はデータ限界を明示し断定しない', async () => {
    const response = await orchestrator.chat({
      message: '山田工務店との最終接点は？',
      scope: 'lcc',
      asOf: ASOF
    });
    expect(response.text).toContain('確定できません');
    expect(response.text).toContain('断定できません');
    expect(response.confidence).toBe('LOW');
  });

  it('「請求漏れてない？」に検出結果を答える', async () => {
    const response = await orchestrator.chat({
      message: '請求漏れてない？',
      scope: 'lcc',
      asOf: ASOF
    });
    expect(response.text).toContain('完工未請求');
    expect(response.uiHint).toBe('ranking');
  });

  it('「危ない現場は？」に粗利悪化ランキングを返す', async () => {
    const response = await orchestrator.chat({
      message: '危ない現場は？',
      scope: 'lcc',
      asOf: ASOF
    });
    expect(response.text).toContain('A案件');
    expect(response.uiHint).toBe('ranking');
  });

  it('「それで送って」は実行せず承認リクエストを作る', async () => {
    const response = await orchestrator.chat({ message: 'それで送って', scope: 'lcc', asOf: ASOF });
    expect(response.approvalRequest).toBeDefined();
    expect(response.approvalRequest?.status).toBe('waiting');
    expect(response.approvalRequest?.riskLevel).toBe(4);
    expect(response.uiHint).toBe('approval');

    const store = await repository.getStore();
    expect(store.approvals).toHaveLength(1);
    expect(store.tasks.some((task) => task.status === 'candidate')).toBe(true);
  });

  it('「この会社調べて」は外部Researchタスクをqueuedで受け付ける', async () => {
    const response = await orchestrator.chat({
      message: 'この会社調べて',
      scope: 'lcc',
      asOf: ASOF
    });
    expect(response.text).toContain('外部調査タスク');
    const store = await repository.getStore();
    expect(store.research).toHaveLength(1);
    expect(store.research[0].status).toBe('queued');
  });

  it('答えられない質問は推測せずUNKNOWNを返す', async () => {
    const response = await orchestrator.chat({ message: '宇宙の天気は？', asOf: ASOF });
    expect(response.confidence).toBe('UNKNOWN');
    expect(response.text).toContain('推測では回答しません');
  });

  it('「おはよう」で朝Briefを返す', async () => {
    const response = await orchestrator.chat({ message: 'おはよう', scope: 'lcc', asOf: ASOF });
    expect(response.uiHint).toBe('brief');
    expect(response.text).toContain('確認が必要です');
  });

  it('「今日何をすべき？」に優先順位付きの要対応を返す', async () => {
    const response = await orchestrator.chat({
      message: '今日何をすべき？',
      scope: 'lcc',
      asOf: ASOF
    });
    expect(response.uiHint).toBe('tasks');
    expect(response.text).toContain('【本日の要対応（優先順）】');
  });
});
