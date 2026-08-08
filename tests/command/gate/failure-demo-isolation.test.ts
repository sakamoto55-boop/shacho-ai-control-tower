import { beforeEach, describe, expect, it } from 'vitest';
import { createCommandApp } from '../../../src/command/server/routes.js';
import {
  InMemoryCommandRepository,
  LocalCommandRepository
} from '../../../src/command/repositories/CommandRepository.js';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';
import { buildSeedDataset } from '../../../src/command/data/seed.js';
import {
  ProductionSourceRegistry,
  emptyDataset
} from '../../../src/command/sources/SourceAdapter.js';
import { ModelRouter, MockCommandModelProvider } from '../../../src/command/ai/ModelRouter.js';
import { MockVoiceProvider } from '../../../src/command/ai/VoiceProvider.js';
import type { CommandModelProvider } from '../../../src/command/ai/ModelRouter.js';
import type { KpiSnapshot } from '../../../src/command/domain/types.js';

const ASOF = '2026-08-08T00:00:00.000Z';
// デモFixtureに含まれる代表的な経営数値。本番障害時に1つでも出たら隔離違反。
const DEMO_NUMBERS = [
  '15,500,000',
  '15500000',
  '12,400,000',
  '12400000',
  '23,225,000',
  '23225000',
  '18,000,000',
  '18000000'
];

function productionRepository(): LocalCommandRepository {
  const dbPath = `${process.env.TMPDIR ?? '/tmp'}/lcc-command-gate-test-${Math.random().toString(36).slice(2)}.json`;
  return new LocalCommandRepository(dbPath, new ProductionSourceRegistry());
}

describe('Gate: Demo Fixture完全隔離', () => {
  beforeEach(() => resetToolIdSeq());

  it('production + ソース未接続時、/kpi はDATA_UNAVAILABLEでデモ数値を一切含まない', async () => {
    const app = createCommandApp({ repository: productionRepository() });
    // productionモード・トークン未設定 → 401（フェイルクローズ）を確認
    const unauthorized = await app.request(`/kpi?scope=lcc`);
    expect(unauthorized.status).toBe(401);

    const tokens = JSON.stringify({ 'tok-p': { role: 'PRESIDENT', companyIds: ['*'] } });
    const authedApp = createCommandApp({ repository: productionRepository(), apiTokens: tokens });
    const res = await authedApp.request(`/kpi?scope=lcc&asOf=${encodeURIComponent(ASOF)}`, {
      headers: { authorization: 'Bearer tok-p' }
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as KpiSnapshot;
    expect(body.dataStatus).toBe('DATA_UNAVAILABLE');
    expect(body.kpis).toHaveLength(0);
    const raw = JSON.stringify(body);
    for (const num of DEMO_NUMBERS) expect(raw).not.toContain(num);
  });

  it('production + ソース未接続時、/chat はCONNECTION ERRORを明示しデモ数値を出さない', async () => {
    const tokens = JSON.stringify({ 'tok-p': { role: 'PRESIDENT', companyIds: ['*'] } });
    const app = createCommandApp({ repository: productionRepository(), apiTokens: tokens });
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { authorization: 'Bearer tok-p', 'content-type': 'application/json' },
      body: JSON.stringify({ message: '現金大丈夫？', scope: 'lcc', asOf: ASOF })
    });
    const body = (await res.json()) as { text: string; dataStatus: string };
    expect(body.dataStatus).toBe('DATA_UNAVAILABLE');
    expect(body.text).toContain('DATA UNAVAILABLE');
    for (const num of DEMO_NUMBERS) expect(body.text).not.toContain(num);
  });

  it('production時、/brief /cash/forecast /cash/scenario は503を返す', async () => {
    const tokens = JSON.stringify({ 'tok-p': { role: 'PRESIDENT', companyIds: ['*'] } });
    const app = createCommandApp({ repository: productionRepository(), apiTokens: tokens });
    const headers = { authorization: 'Bearer tok-p', 'content-type': 'application/json' };
    expect((await app.request(`/brief?scope=lcc`, { headers })).status).toBe(503);
    expect((await app.request(`/cash/forecast?scope=lcc`, { headers })).status).toBe(503);
    expect(
      (
        await app.request('/cash/scenario', {
          method: 'POST',
          headers,
          body: JSON.stringify({ scope: 'lcc', adjustments: [] })
        })
      ).status
    ).toBe(503);
  });

  it('demoモードのデータセットはmeta.mode=demoを必ず持つ（混在検知）', () => {
    const dataset = buildSeedDataset(ASOF);
    expect(dataset.meta.mode).toBe('demo');
    expect(dataset.meta.sources.every((s) => s.sourceType === 'demo_fixture')).toBe(true);
    const production = emptyDataset(ASOF, { mode: 'production', sources: [] });
    expect(production.projects).toHaveLength(0);
    expect(production.cashAccounts).toHaveLength(0);
  });
});

describe('Gate: 障害・部分データ', () => {
  beforeEach(() => resetToolIdSeq());

  it('一部ソース欠損時はPARTIALを明示する', async () => {
    const repository = new InMemoryCommandRepository((asOf) => {
      const dataset = buildSeedDataset(asOf);
      dataset.meta.sources = dataset.meta.sources.map((source) =>
        source.sourceName === 'InvoiceSource'
          ? {
              ...source,
              sourceType: 'not_configured',
              errorState: 'Source timeout',
              confidence: 'UNKNOWN'
            }
          : source
      );
      return dataset;
    });
    const orchestrator = new CommandOrchestrator(repository);
    const res = await orchestrator.chat({ message: '今月どう？', scope: 'lcc', asOf: ASOF });
    expect(res.dataStatus).toBe('PARTIAL');
  });

  it('古い銀行データ（VERY_STALE）では「問題なし」と断定しない', async () => {
    const repository = new InMemoryCommandRepository((asOf) => {
      const dataset = buildSeedDataset(asOf);
      dataset.cashAccounts = dataset.cashAccounts.map((account) => ({
        ...account,
        freshness: {
          lastUpdatedAt: '2026-08-03T00:00:00.000Z',
          source: '銀行明細（5日前）',
          stale: true
        }
      }));
      return dataset;
    });
    const orchestrator = new CommandOrchestrator(repository);
    const res = await orchestrator.chat({ message: '現金大丈夫？', scope: 'lcc', asOf: ASOF });
    expect(res.confidence).toBe('LOW');
    expect(res.text).toContain('断定できません');
  });

  it('Researchプロバイダ障害でもシステム全体は動き続ける', async () => {
    const repository = new InMemoryCommandRepository();
    repository.saveResearch = async () => {
      throw new Error('research provider down');
    };
    const app = createCommandApp({ repository });
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'この会社調べて', scope: 'lcc', asOf: ASOF })
    });
    expect(res.status).toBe(400); // エラーは返るが…
    const after = await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '今月どう？', scope: 'lcc', asOf: ASOF })
    });
    expect(after.status).toBe(200); // …後続の会話は正常
  });

  it('Model Router: Provider障害時に代替へフォールバックし、全滅時は明示的に失敗する', async () => {
    class FailingProvider implements CommandModelProvider {
      providerId = 'failing';
      async complete(): Promise<string> {
        throw new Error('provider down');
      }
    }
    const router = new ModelRouter({ routes: {}, defaultRoute: ['failing', 'mock'] });
    router.register(new FailingProvider());
    router.register(new MockCommandModelProvider());
    const result = await router.complete({
      purpose: 'conversation',
      systemPrompt: '',
      userMessage: 'test'
    });
    expect(result.providerId).toBe('mock');

    const deadRouter = new ModelRouter({ routes: {}, defaultRoute: ['failing'] });
    deadRouter.register(new FailingProvider());
    await expect(
      deadRouter.complete({ purpose: 'conversation', systemPrompt: '', userMessage: 'x' })
    ).rejects.toThrow();
  });

  it('音声はOrchestratorと疎結合: VoiceProviderなしでもテキスト会話が完結する', async () => {
    // OrchestratorはVoiceProviderへの依存を持たない（import自体がない）
    const orchestrator = new CommandOrchestrator(new InMemoryCommandRepository());
    const res = await orchestrator.chat({ message: '今月どう？', scope: 'lcc', asOf: ASOF });
    expect(res.text.length).toBeGreaterThan(0);
    // 音声側はAdapter単体で差し替え可能
    const voice = new MockVoiceProvider();
    const synthesis = await voice.synthesize(res.text);
    expect(synthesis.provider).toBe('mock');
  });
});
