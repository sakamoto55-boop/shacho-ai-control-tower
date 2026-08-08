import { beforeEach, describe, expect, it } from 'vitest';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';
import { resetMemorySeq } from '../../../src/command/memory/store.js';
import { classifyConversation } from '../../../src/command/orchestrator/universalRouter.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('M: 会話からの学習（Persistent Learning Loop）', () => {
  let repository: InMemoryCommandRepository;
  let orchestrator: CommandOrchestrator;

  const chat = (message: string, sessionId = 'm1') =>
    orchestrator.chat({ message, scope: 'lcc', asOf: ASOF, sessionId });

  beforeEach(() => {
    resetToolIdSeq();
    resetMemorySeq();
    repository = new InMemoryCommandRepository();
    orchestrator = new CommandOrchestrator(repository);
  });

  it('Fact vs Opinion: 「営業部弱くない？」はFACTでなくHYPOTHESIS(UNVERIFIED)として保存される', async () => {
    await chat('最近営業部弱くない？');
    const memories = await repository.getMemories();
    const saved = memories.find((m) => m.statement.includes('営業部'));
    expect(saved).toBeDefined();
    expect(saved!.type).toBe('HYPOTHESIS');
    expect(saved!.confidence).toBe('UNVERIFIED');
    expect(memories.some((m) => m.type === 'FACT' && m.statement.includes('営業部'))).toBe(false);
  });

  it('決定の宣言はDECISION候補（PENDING_REVIEW）になり、AIは正式確定しない', async () => {
    const res = await chat('公共工事は特定分野のみ受注することにした');
    const memories = await repository.getMemories();
    const decision = memories.find((m) => m.type === 'DECISION');
    expect(decision).toBeDefined();
    expect(decision!.reviewStatus).toBe('PENDING_REVIEW');
    expect(res.text).toContain('確認待ち');
    // 既存のアラート抑制用Decision（正式）は作られない
    expect((await repository.getStore()).decisions).toHaveLength(0);
  });

  it('Cross-session Memory Recall: 別セッションでも「前に言ってたこと」を想起できる', async () => {
    await chat('最近営業部弱くない？', 'session-a');
    const recall = await chat('前に営業部について言ってたこと覚えてる？', 'session-b');
    expect(recall.text).toContain('営業部');
    expect(recall.text).toContain('HYPOTHESIS');
    expect(recall.confidence).not.toBe('UNKNOWN');
  });

  it('User Correction: 「それ違う。今は◯◯」で履歴を保持して更新する', async () => {
    await chat('最近営業部弱くない？');
    await chat('前に営業部について言ってたこと覚えてる？');
    const corrected = await chat('それ違う。今は営業体制を強化して改善済み');
    expect(corrected.text).toContain('記憶を更新しました');
    const memories = await repository.getMemories();
    const old = memories.find((m) => m.status === 'CORRECTED');
    const current = memories.find((m) => m.status === 'ACTIVE' && m.statement.includes('強化'));
    expect(old).toBeDefined();
    expect(current).toBeDefined();
    expect(old!.supersededBy).toBe(current!.memoryId);
  });

  it('Provenance: 「それどこから？」で記憶の出典を答える', async () => {
    await chat('最近営業部弱くない？');
    await chat('前に営業部について言ってたこと覚えてる？');
    const res = await chat('それどこから？');
    expect(res.text).toContain('出典');
    expect(res.text).toContain('CONVERSATION');
  });

  it('Decision Review: 「それ、今も正しい？」で有効性を答える', async () => {
    await chat('公共工事は特定分野のみ受注することにした');
    await chat('前に公共工事について決めたこと何だっけ？');
    const res = await chat('それ、今も正しい？');
    expect(res.text).toMatch(/ACTIVE|有効/);
    expect(res.text).toContain('確認待ち');
  });

  it('Memory Audit: 「会社について何を覚えている？」に内訳を答える', async () => {
    await chat('最近営業部弱くない？');
    await chat('見積後の追客漏れが問題');
    const res = await chat('会社について何を覚えている？');
    expect(res.text).toMatch(/有効な記憶は\d+件/);
    expect(res.text).toContain('HYPOTHESIS');
    expect(res.text).toContain('ブラックボックス');
  });

  it('Sensitive Memory: 給与実額を含む発言は記憶へ複製されない', async () => {
    await chat('田中の月給は350,000円にすることにした');
    const memories = await repository.getMemories();
    expect(memories.every((m) => !m.statement.includes('350,000'))).toBe(true);
  });

  it('該当記憶がない想起はUNKNOWN（推測で補わない）', async () => {
    const res = await chat('前に宇宙開発について決めたこと何だっけ？');
    expect(res.confidence).toBe('UNKNOWN');
    expect(res.text).toContain('見つかりませんでした');
  });

  it('General Fallback: 固定Intent外はUNKNOWN終了でなく汎用経路へ（モデル未接続は正直に言う）', async () => {
    const res = await chat('豆腐の作り方を教えて');
    expect(res.text).toContain('接続されていません');
    expect(res.text).toContain('推測では回答しません');
    expect(res.confidence).toBe('UNKNOWN');
  });

  it('Universal Router: 複合質問を多重分類する', () => {
    const categories = classifyConversation('A案件の利益が悪い理由を調べて対策考えて');
    expect(categories).toContain('DATA_ANALYSIS');
    expect(categories).toContain('RESEARCH');
    expect(categories.length).toBeGreaterThanOrEqual(2);
    expect(classifyConversation('こんにちは')).toEqual(['GENERAL_CONVERSATION']);
  });

  it('Innovation Engine: 対策依頼に前提挑戦つき複数案（最小テスト付き）を返す', async () => {
    const res = await chat('見積後の追客漏れをなくす対策を考えて');
    expect(res.text).toContain('Conservative');
    expect(res.text).toContain('Practical');
    expect(res.text).toContain('Innovative');
    expect(res.text).toContain('前提を疑う');
    expect(res.text).toContain('最小テスト');
    expect(res.text).toContain('最終判断は経営者');
  });

  it('Innovation Engine: 簡潔指定なら過剰展開しない', async () => {
    const full = await chat('追客漏れの対策を考えて');
    const brief = await chat('簡潔に、追客漏れの対策を考えて', 'm2');
    expect(brief.text.length).toBeLessThan(full.text.length / 2);
  });
});
