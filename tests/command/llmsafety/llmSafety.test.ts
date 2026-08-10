/**
 * 是正⑦（ACCEPTANCE BLOCKER CORRECTION 7）テスト。
 *
 * 1. Provider状態: キー存在だけでACTIVEにしない（実疎通の結果で判定）
 * 2. production honest fallback: 実Provider失敗時にmockエコーバックしない
 * 3. Memory想起Router: Preference等の想起質問はMemory検索を先に試す
 * 4. LLM Curator: 候補生成と障害時diagnostics
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProviderVerificationService,
  createDefaultProber,
  mapHttpStatus,
  classifyProviderError,
  type ProviderProbeResult
} from '../../../src/command/ai/providerVerification.js';
import { createDefaultRegistry } from '../../../src/command/agents/providerRegistry.js';
import {
  GeneralReasoner,
  createGeneralRouter,
  isMockFallbackAllowed
} from '../../../src/command/ai/generalReasoner.js';
import { ModelRouter, type CommandModelProvider } from '../../../src/command/ai/ModelRouter.js';
import {
  isMemoryRecallIntent,
  CommandOrchestrator
} from '../../../src/command/orchestrator/orchestrator.js';
import {
  InMemoryCommandRepository,
  LocalCommandRepository
} from '../../../src/command/repositories/CommandRepository.js';
import { MemoryService } from '../../../src/command/memory/store.js';
import { curateConversationTurn } from '../../../src/command/memory/curator.js';
import { ObservabilityLog } from '../../../src/command/observability/observability.js';
import type { Principal } from '../../../src/command/domain/types.js';

const PRESIDENT: Principal = { role: 'PRESIDENT', companyIds: [], label: '社長' };
const ASOF = '2026-08-01T09:00:00+09:00';

function fakeProber(
  status: number | 'timeout'
): (providerId: string) => Promise<ProviderProbeResult> {
  return async (providerId) => {
    const checkedAt = '2026-08-10T00:00:00.000Z';
    if (status === 'timeout') {
      return { providerId, status: 'TEMPORARILY_UNAVAILABLE', checkedAt, retryable: true };
    }
    return mapHttpStatus(providerId, status, checkedAt);
  };
}

class FailingProvider implements CommandModelProvider {
  providerId = 'anthropic';
  constructor(private readonly httpStatus: number) {}
  async complete(): Promise<string> {
    const error = new Error('provider error') as Error & { status: number };
    error.status = this.httpStatus;
    throw error;
  }
}

describe('是正⑦ 修正1: Provider状態の実疎通判定', () => {
  it('1) キーなし: NOT_CONFIGURED（疎通は行わない）', async () => {
    const service = new ProviderVerificationService(fakeProber(200), () => false);
    const result = await service.getStatus('anthropic');
    expect(result.status).toBe('NOT_CONFIGURED');
  });

  it('2) キー存在・未検証: registryはCONFIGURED_UNVERIFIED（READY/ACTIVEにしない）', () => {
    const registry = createDefaultRegistry({ ANTHROPIC_API_KEY: 'sk-test' });
    const view = registry.describe().find((v) => v.providerId === 'anthropic');
    expect(view?.status).toBe('CONFIGURED_UNVERIFIED');
    const service = new ProviderVerificationService(fakeProber(200), (id) => id === 'anthropic');
    expect(service.unverifiedStatus('anthropic')).toBe('CONFIGURED_UNVERIFIED');
    expect(service.unverifiedStatus('openai')).toBe('NOT_CONFIGURED');
  });

  it('3) 実API成功: ACTIVE', async () => {
    const service = new ProviderVerificationService(fakeProber(200), () => true);
    expect((await service.getStatus('anthropic')).status).toBe('ACTIVE');
  });

  it('4) 401: AUTH_FAILED（retryable=false）', async () => {
    const service = new ProviderVerificationService(fakeProber(401), () => true);
    const result = await service.getStatus('anthropic');
    expect(result.status).toBe('AUTH_FAILED');
    expect(result.retryable).toBe(false);
    expect(result.httpStatus).toBe(401);
  });

  it('5) 429: RATE_LIMITED（retryable=true）', async () => {
    const service = new ProviderVerificationService(fakeProber(429), () => true);
    const result = await service.getStatus('anthropic');
    expect(result.status).toBe('RATE_LIMITED');
    expect(result.retryable).toBe(true);
  });

  it('6) 5xx / timeout: TEMPORARILY_UNAVAILABLE', async () => {
    const service500 = new ProviderVerificationService(fakeProber(500), () => true);
    expect((await service500.getStatus('anthropic')).status).toBe('TEMPORARILY_UNAVAILABLE');
    const serviceTimeout = new ProviderVerificationService(fakeProber('timeout'), () => true);
    expect((await serviceTimeout.getStatus('anthropic')).status).toBe('TEMPORARILY_UNAVAILABLE');
  });

  it('疎通結果は短時間キャッシュされる（TTL内は再疎通しない）', async () => {
    let calls = 0;
    const service = new ProviderVerificationService(
      async (id) => {
        calls += 1;
        return mapHttpStatus(id, 200, '2026-08-10T00:00:00.000Z');
      },
      () => true
    );
    const t0 = 1_750_000_000_000;
    await service.getStatus('anthropic', t0);
    await service.getStatus('anthropic', t0 + 1000);
    expect(calls).toBe(1);
    await service.getStatus('anthropic', t0 + 6 * 60_000);
    expect(calls).toBe(2);
  });

  it('既定Proberはキー未設定Providerに対しNOT_CONFIGUREDを返す（外部通信なし）', async () => {
    const prober = createDefaultProber({});
    expect((await prober('anthropic')).status).toBe('NOT_CONFIGURED');
    expect((await prober('openai')).status).toBe('NOT_CONFIGURED');
    expect((await prober('gemini')).status).toBe('NOT_CONFIGURED');
  });

  it('classifyProviderError: 401→AUTH_FAILED / 429→RATE_LIMITED / その他→TEMPORARILY_UNAVAILABLE', () => {
    const e401 = Object.assign(new Error('x'), { status: 401 });
    const e429 = Object.assign(new Error('x'), { status: 429 });
    expect(classifyProviderError(e401)).toBe('AI_AUTH_FAILED');
    expect(classifyProviderError(e429)).toBe('AI_RATE_LIMITED');
    expect(classifyProviderError(new Error('network'))).toBe('AI_TEMPORARILY_UNAVAILABLE');
  });
});

describe('是正⑦ 修正2: productionの正直なFallback', () => {
  it('productionではmockフォールバックを許可しない（明示設定を除く）', () => {
    expect(isMockFallbackAllowed({ LCC_COMMAND_MODE: 'production' })).toBe(false);
    expect(isMockFallbackAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(isMockFallbackAllowed({})).toBe(true);
    expect(
      isMockFallbackAllowed({ LCC_COMMAND_MODE: 'production', LCC_COMMAND_ALLOW_MOCK_LLM: 'true' })
    ).toBe(true);
  });

  it('7) productionでProvider失敗時: mock回答を返さない（正直な利用不能応答）', async () => {
    const router = createGeneralRouter({
      LCC_COMMAND_MODE: 'production',
      ANTHROPIC_API_KEY: 'sk-ant-invalid-for-test'
    });
    // 実SDK呼び出しを失敗Providerへ差し替え（401相当）
    router.register(new FailingProvider(401));
    const reasoner = new GeneralReasoner(router);
    const question = '一般論として、部門長会議を30分以内に終える方法を3つ提案してください。';
    const answer = await reasoner.answer(question, []);
    expect(answer.available).toBe(false);
    expect(answer.reasonCode).toBe('AI_AUTH_FAILED');
    expect(answer.text).toContain('現在、相談AIへ接続できません');
    expect(answer.text).toContain('Memory検索と社内データ検索は利用できます');
  });

  it('8) productionでProvider失敗時: 質問文をエコーバックしない', async () => {
    const router = createGeneralRouter({
      LCC_COMMAND_MODE: 'production',
      ANTHROPIC_API_KEY: 'sk-ant-invalid-for-test'
    });
    router.register(new FailingProvider(401));
    const reasoner = new GeneralReasoner(router);
    const question = '一般論として、部門長会議を30分以内に終える方法を3つ提案してください。';
    const answer = await reasoner.answer(question, []);
    expect(answer.text).not.toContain(question);
    expect(answer.text).not.toContain('【質問】');
  });

  it('万一mockが選ばれても回答として返さない（エコーバック禁止の二重防御）', async () => {
    const router = Object.assign(new ModelRouter({ routes: {}, defaultRoute: ['mock'] }), {
      hasRealProvider: true
    });
    const reasoner = new GeneralReasoner(router);
    const answer = await reasoner.answer('テスト質問', []);
    expect(answer.available).toBe(false);
    expect(answer.text).not.toContain('テスト質問');
  });

  it('障害はllm_incidentとしてdiagnosticsへ記録される（キー・本文なし）', async () => {
    const router = createGeneralRouter({
      LCC_COMMAND_MODE: 'production',
      ANTHROPIC_API_KEY: 'sk-ant-invalid-for-test'
    });
    router.register(new FailingProvider(429));
    const diagnostics: unknown[] = [];
    const reasoner = new GeneralReasoner(router, (d) => diagnostics.push(d));
    await reasoner.answer('質問', []);
    expect(diagnostics).toHaveLength(1);
    const d = diagnostics[0] as { reasonCode: string; retryable: boolean; occurredAt: string };
    expect(d.reasonCode).toBe('AI_RATE_LIMITED');
    expect(d.retryable).toBe(true);
    expect(d.occurredAt).toBeTruthy();
    expect(JSON.stringify(d)).not.toContain('sk-ant');
  });
});

describe('是正⑦ 修正3: Memory想起Router', () => {
  const chat = (orchestrator: CommandOrchestrator, message: string) =>
    orchestrator.chat({ message, scope: 'lcc', asOf: ASOF, sessionId: 'llm-safety' }, PRESIDENT);

  it('想起Intent判定: 指定の質問群を想起候補とする', () => {
    expect(isMemoryRecallIntent('私が希望している回答の順番を教えて')).toBe(true);
    expect(isMemoryRecallIntent('私の好みを教えて')).toBe(true);
    expect(isMemoryRecallIntent('私が重視していることは？')).toBe(true);
    expect(isMemoryRecallIntent('前回の判断を教えて')).toBe(true);
    expect(isMemoryRecallIntent('会社の原則を教えて')).toBe(true);
    expect(isMemoryRecallIntent('これまで覚えたことを教えて')).toBe(true);
  });

  it('一般論質問は想起Intentにしない（過剰なMemory検索を強制しない）', () => {
    expect(
      isMemoryRecallIntent('一般論として、部門長会議を30分以内に終える方法を3つ提案してください。')
    ).toBe(false);
    expect(isMemoryRecallIntent('今日の天気はどうですか')).toBe(false);
  });

  it('9) 想起質問はmemory_searchを使い、保存済み内容とEvidenceを回答する', async () => {
    const repository = new InMemoryCommandRepository();
    const orchestrator = new CommandOrchestrator(repository);
    await chat(
      orchestrator,
      '今後、私への回答は、最初に結論、その後に根拠、最後に次の一手の順で出してください。覚えておいて'
    );
    const recall = await chat(orchestrator, '私が希望している回答の順番を教えて');
    expect(recall.toolsUsed).toContain('memory_search');
    expect(recall.text).toContain('最初に結論');
    expect(recall.evidence.length).toBeGreaterThan(0);
  });

  it('10) 一般論質問: Memory recallルートへ強制しない', async () => {
    const repository = new InMemoryCommandRepository();
    const orchestrator = new CommandOrchestrator(repository);
    const res = await chat(
      orchestrator,
      '一般論として、部門長会議を30分以内に終える方法を3つ提案してください。'
    );
    expect(res.toolsUsed).not.toContain('memory_search');
  });

  it('11) 再起動後（別インスタンス再読込）: Memory IDが維持される', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llmsafety-'));
    const dbPath = join(dir, 'db.json');
    const repository = new LocalCommandRepository(dbPath);
    const orchestrator = new CommandOrchestrator(repository);
    await chat(orchestrator, '今後、報告は結論から先に。覚えておいて');
    const before = await repository.getMemories();
    expect(before.length).toBeGreaterThan(0);
    // 同じdbPathで新しいRepository（=プロセス再起動相当）
    const repository2 = new LocalCommandRepository(dbPath);
    const after = await repository2.getMemories();
    expect(after.map((m) => m.memoryId)).toEqual(before.map((m) => m.memoryId));
  });
});

describe('是正⑦ LLM Curator', () => {
  it('12) LLM Curator: PREFERENCE候補を生成し、confidence/reviewStatus/Evidence付きで保存する', async () => {
    const repository = new InMemoryCommandRepository();
    const service = new MemoryService(repository);
    const dataset = await repository.getDataset(ASOF);
    const message = '私は、曖昧に賛成されるより、問題点を先に率直に指摘してもらう方が助かります。';
    const result = await curateConversationTurn(
      service,
      dataset,
      message,
      PRESIDENT,
      'lcc',
      ASOF,
      'session-1',
      // LLM Curator v2のfake抽出（実LLM応答相当）。Learning Safetyはstore側が強制する
      async () => [
        {
          type: 'PREFERENCE',
          statement: '曖昧な賛成より、問題点を先に率直に指摘してほしい'
        }
      ]
    );
    expect(result.saved.length).toBeGreaterThan(0);
    const saved = result.saved.find((s) => s.record.type === 'PREFERENCE') ?? result.saved[0];
    expect(saved.record.memoryId).toBeTruthy();
    expect(saved.record.reviewStatus).toBeTruthy();
    expect(saved.record.confidence).toBeTruthy();
    expect(saved.record.evidence.length).toBeGreaterThan(0);
    expect(JSON.stringify(saved.record)).not.toContain('sk-ant');
  });

  it('Curator障害は無言で握りつぶさずllm_incidentへ記録される', async () => {
    const repository = new InMemoryCommandRepository();
    const observability = new ObservabilityLog();
    const orchestrator = new CommandOrchestrator(repository, {
      observability,
      curatorExtractor: async () => {
        const error = new Error('curator down') as Error & { status: number };
        error.status = 401;
        throw error;
      }
    });
    const res = await orchestrator.chat(
      { message: '本日の現場報告です。特に問題ありません。', scope: 'lcc', asOf: ASOF },
      PRESIDENT
    );
    expect(res.text).toBeTruthy(); // 会話自体は壊れない
    // observability.recordは非同期（void）のため反映を待つ
    await new Promise((resolve) => setTimeout(resolve, 20));
    const incidents = observability.recent(10, 'llm_incident');
    const curatorIncident = incidents.find((i) => i.provider === 'memory_curator');
    expect(curatorIncident).toBeDefined();
    expect(curatorIncident?.reasonCode).toBe('AI_AUTH_FAILED');
    expect(curatorIncident?.retryable).toBe(false);
  });
});
