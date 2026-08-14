import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntelligenceJobRunner } from '../../../src/command/intelligence/jobRunner.js';
import { IntelligenceStore } from '../../../src/command/intelligence/store.js';
import type { ResearchTask } from '../../../src/command/domain/types.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'lcc-job-'));
const task = (over: Partial<ResearchTask> = {}): ResearchTask => ({
  researchId: 'r1', companyId: 'lcc', question: '解体工事の相場動向を調べて',
  provider: 'other', status: 'queued', requestedAt: new Date().toISOString(), ...over // §G: LLM単体処理をweb_searchと呼ばない
});
const mkSave = () => {
  const saved: ResearchTask[] = [];
  return { saved, saveResearch: async (t: ResearchTask) => { saved.push(t); return t; } };
};

describe('DIOS Job Runner（§7・queued止まりの解消）', () => {
  it('設定済みLLMで実行しSUCCEEDED+HYPOTHESIS扱いでAgentRunへ記録。LLM_ANALYSIS/UNVERIFIED_SOURCESを明示し、未検証URLへfetchedAtを付けない（§G）', async () => {
    const store = new IntelligenceStore(tmp());
    const { saved, saveResearch } = mkSave();
    const runner = new IntelligenceJobRunner({
      store, saveResearch,
      providers: { anthropic: { providerId: 'anthropic', complete: async () => '相場は上昇傾向。出典: https://example.com/market 2026-08時点' } }
    });
    const { task: done, run } = await runner.runTask(task());
    expect(done.status).toBe('completed');
    expect(done.result?.summary).toContain('LLM_ANALYSIS'); // Web検索と偽らない
    expect(done.result?.summary).toContain('UNVERIFIED_SOURCES');
    expect(done.result?.summary).toContain('https://example.com/market'); // URL自体は提示
    expect(done.result?.sources).toHaveLength(0); // 実取得していないURLへfetchedAtを付けない
    expect(run.status).toBe('SUCCEEDED');
    expect(run.provider).toBe('anthropic');
    expect(run.resultSummary).toContain('[LLM_ANALYSIS]');
    expect(run.resultTrust).toBe('HYPOTHESIS'); // 外部AI回答は事実登録しない
    expect(saved.map((s) => s.status)).toEqual(['running', 'completed']);
    expect(run.durationMs).not.toBeNull();
  });

  it('Provider未設定はWAITING_PROVIDER+NOT_CONFIGUREDを正直に記録し、実行したふりをしない', async () => {
    const store = new IntelligenceStore(tmp());
    const { saved, saveResearch } = mkSave();
    const runner = new IntelligenceJobRunner({ store, saveResearch, providers: {} });
    const { task: t, run } = await runner.runTask(task());
    expect(t.status).toBe('queued'); // 状態を偽らない
    expect(run.status).toBe('WAITING_PROVIDER');
    expect(run.resultSummary).toContain('NOT_CONFIGURED');
    expect(saved).toHaveLength(0);
  });

  it('実行失敗はFAILEDへ遷移し、エラーを記録する', async () => {
    const store = new IntelligenceStore(tmp());
    const { saveResearch } = mkSave();
    const runner = new IntelligenceJobRunner({
      store, saveResearch,
      providers: { openai: { providerId: 'openai', complete: async () => { throw new Error('HTTP 429'); } } }
    });
    const { task: t, run } = await runner.runTask(task());
    expect(t.status).toBe('failed');
    expect(run.status).toBe('FAILED');
    expect(run.resultSummary).toContain('HTTP 429');
  });

  it('高重要度（金銭・安全等）は別検査対象として明示される', async () => {
    const store = new IntelligenceStore(tmp());
    const { saveResearch } = mkSave();
    const runner = new IntelligenceJobRunner({
      store, saveResearch,
      providers: { gemini: { providerId: 'gemini', complete: async () => '回答' } }
    });
    const { run } = await runner.runTask(task({ question: '契約解約時の違約金の一般的な扱い' }));
    expect(run.costNote).toContain('再検査対象');
  });

  it('runPendingはqueuedのみを上限件数まで処理する', async () => {
    const store = new IntelligenceStore(tmp());
    const { saveResearch } = mkSave();
    const runner = new IntelligenceJobRunner({
      store, saveResearch,
      providers: { anthropic: { providerId: 'anthropic', complete: async () => 'ok' } }
    });
    const results = await runner.runPending([
      task({ researchId: 'a' }), task({ researchId: 'b', status: 'completed' }), task({ researchId: 'c' })
    ], 1);
    expect(results).toHaveLength(1);
    expect(results[0].task.researchId).toBe('a');
  });
});
