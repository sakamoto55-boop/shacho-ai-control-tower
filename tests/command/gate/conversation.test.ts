import { beforeEach, describe, expect, it } from 'vitest';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';

const ASOF = '2026-08-08T00:00:00.000Z';
const S = 'session-1';

describe('Gate: 会話コンテキスト（multi-turn / 代名詞解決 / 追い質問）', () => {
  let repository: InMemoryCommandRepository;
  let orchestrator: CommandOrchestrator;

  const chat = (message: string, sessionId = S, scope?: string) =>
    orchestrator.chat({ message, sessionId, scope, asOf: ASOF });

  beforeEach(() => {
    resetToolIdSeq();
    repository = new InMemoryCommandRepository();
    orchestrator = new CommandOrchestrator(repository);
  });

  it('§5の基本対話が最後まで成立する（売上→危険→詳細→原因→対策→担当→下書き→承認）', async () => {
    const r1 = await chat('今月どう？', S, 'lcc');
    expect(r1.text).toContain('着地予測');

    const r2 = await chat('一番危ないのは？');
    expect(r2.text).toContain('A案件');
    expect(r2.text).toContain('24.8%');

    const r3 = await chat('その案件詳しく');
    expect(r3.text).toContain('A案件');
    expect(r3.uiHint).toBe('project_card');

    const r4 = await chat('なぜ利益落ちた？');
    expect(r4.text).toContain('【主因】');
    expect(r4.text).toContain('外注費が見積比＋800,000円');

    const r5 = await chat('どうすればいい？');
    expect(r5.text).toContain('【確認できた事実】');
    expect(r5.text).toContain('【AIの提案】');
    expect(r5.text).toContain('最終判断は経営者');

    const r6 = await chat('担当は？');
    expect(r6.text).toContain('田中');

    const r7 = await chat('連絡文作って');
    expect(r7.text).toContain('下書きを作成しました');
    expect(r7.text).toContain('出雲不動産株式会社様');
    expect(r7.approvalRequest).toBeUndefined(); // LEVEL 2は承認不要

    const r8 = await chat('それで送って');
    expect(r8.approvalRequest?.status).toBe('waiting');
    expect(r8.approvalRequest?.riskLevel).toBe(4);
    expect(r8.text).toContain('出雲不動産株式会社');
    expect(r8.approvalRequest?.after).toContain('出雲不動産株式会社様');
  });

  it('「2番目」で直前リストの2番目を解決する', async () => {
    await chat('今日何をすべき？');
    const r = await chat('2番目');
    expect(r.confidence).not.toBe('UNKNOWN');
    expect(r.text.length).toBeGreaterThan(5);
  });

  it('「根拠は？」で直前回答の根拠を返す', async () => {
    await chat('A案件なぜ利益悪い？', S, 'lcc');
    const r = await chat('根拠は？');
    expect(r.text).toContain('直前の回答の根拠');
    expect(r.text).toContain('受注額');
  });

  it('「本当に？」で確信度と根拠件数を答える', async () => {
    await chat('今月どう？', S, 'lcc');
    const r = await chat('本当に？');
    expect(r.text).toContain('Data Confidence');
    expect(r.text).toContain('根拠データ');
  });

  it('「他にない？」で直前リストの続きを返す', async () => {
    await chat('今月どう？', S, 'lcc'); // パイプライン6件中3件表示
    const r = await chat('他にない？');
    expect(r.text).toContain('続き');
  });

  it('「逆に」で直前リストを逆順にする', async () => {
    await chat('今月どう？', S, 'lcc');
    const r = await chat('逆に');
    expect(r.text).toContain('逆順');
  });

  it('「グループ全体では？」「LCCだけなら？」でスコープを切り替えて再計算する', async () => {
    await chat('現金大丈夫？', S, 'lcc');
    const group = await chat('グループ全体では？');
    expect(group.text).toContain('17,500,000円');
    const lcc = await chat('LCCだけなら？');
    expect(lcc.text).toContain('15,500,000円');
  });

  it('「去年と比べて」はデータ未接続を明示しUNKNOWNを返す', async () => {
    await chat('今月どう？', S, 'lcc');
    const r = await chat('去年と比べて');
    expect(r.confidence).toBe('UNKNOWN');
    expect(r.text).toContain('前年比較はできません');
  });

  it('複合質問: 資金繰りと売上を統合し最重要リスクを特定する', async () => {
    const r = await chat('資金繰りと売上を見て、今月一番危ないことを教えて', S, 'lcc');
    expect(r.text).toContain('【資金繰り】');
    expect(r.text).toContain('【売上】');
    expect(r.text).toContain('【最重要】');
    expect(r.toolsUsed).toContain('get_cash_forecast');
    expect(r.toolsUsed).toContain('get_sales_summary');
  });

  it('セッションが異なればコンテキストを共有しない', async () => {
    await chat('A案件なぜ利益悪い？', 'session-a', 'lcc');
    const r = await chat('その案件詳しく', 'session-b');
    expect(r.confidence).toBe('UNKNOWN'); // session-bには直前案件がない
  });

  it('会話からAIが勝手にDecision（経営判断Memory）を登録しない', async () => {
    await chat('A案件は粗利より完工を優先で', S, 'lcc');
    await chat('どうすればいい？');
    const store = await repository.getStore();
    expect(store.decisions).toHaveLength(0);
  });

  it('未知の質問は推測せずUNKNOWN、データ欠損は欠損と言う', async () => {
    const unknown = await chat('宇宙の天気は？');
    expect(unknown.confidence).toBe('UNKNOWN');
    const missing = await chat('大社商事との最終接点は？', S, 'lcc');
    expect(missing.text).toMatch(/確定できません|ありません/);
  });
});
