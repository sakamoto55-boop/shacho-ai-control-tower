import { beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { createCommandApp } from '../../../src/command/server/routes.js';
import { ServiceAccountTokenProvider } from '../../../src/command/sources/googleSheets.js';
import { DATA_GAPS, openGaps } from '../../../src/command/domain/dataGaps.js';
import { assessCapabilities } from '../../../src/command/domain/capability.js';
import { createDefaultRegistry } from '../../../src/command/agents/providerRegistry.js';
import {
  TargetRegistryService,
  resetTargetSeq
} from '../../../src/command/targets/targetRegistry.js';
import { CommandEventBus } from '../../../src/command/events/eventBus.js';
import { buildUiResponse } from '../../../src/command/domain/uiSchema.js';
import {
  HALLUCINATION_PROBES,
  runRealEvaluation
} from '../../../src/command/evaluation/realEval.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';
import { resetMemorySeq } from '../../../src/command/memory/store.js';
import { resetPlanSeq } from '../../../src/command/agents/rolePlanner.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('B1.5: Live Beta Activation Preparation', () => {
  let repository: InMemoryCommandRepository;

  beforeEach(() => {
    resetToolIdSeq();
    resetMemorySeq();
    resetPlanSeq();
    resetTargetSeq();
    repository = new InMemoryCommandRepository();
  });

  it('Service Account: RS256署名JWT（spreadsheets.readonlyスコープ固定）とトークンキャッシュ', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    let tokenCalls = 0;
    const provider = new ServiceAccountTokenProvider(
      {
        client_email: 'lcc-command@example.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
      },
      {
        nowMs: () => 1_754_000_000_000,
        fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
          tokenCalls += 1;
          expect(String(url)).toBe('https://oauth2.googleapis.com/token');
          const body = String(init?.body);
          expect(body).toContain('grant_type=urn');
          return new Response(JSON.stringify({ access_token: 'token-abc', expires_in: 3600 }), {
            status: 200
          });
        }) as typeof fetch
      }
    );

    const assertion = provider.buildAssertion(1_754_000_000);
    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT'
    });
    const parsedClaims = JSON.parse(Buffer.from(claims, 'base64url').toString()) as {
      scope: string;
      exp: number;
      iat: number;
    };
    expect(parsedClaims.scope).toBe('https://www.googleapis.com/auth/spreadsheets.readonly');
    expect(parsedClaims.exp - parsedClaims.iat).toBe(3600);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);

    expect(await provider.getToken()).toBe('token-abc');
    expect(await provider.getToken()).toBe('token-abc'); // キャッシュ再利用
    expect(tokenCalls).toBe(1);
  });

  it('Data Gap Registry: 実測Evidence付きで日報・銀行・目標のGapを管理する', () => {
    const dg1 = DATA_GAPS.find((g) => g.gapId === 'DG-001');
    expect(dg1?.severity).toBe('HIGH');
    expect(dg1?.status).toBe('SOURCE_IDENTIFIED');
    expect(dg1?.currentSource).toContain('日報データ（AI読み取り）');
    expect(dg1?.evidence.length).toBeGreaterThan(1);
    expect(dg1?.capabilityImpact).toContain('LABOR_ACTUAL');
    const bank = DATA_GAPS.find((g) => g.gapId === 'DG-004');
    expect(bank?.capabilityImpact).toContain('UNKNOWN');
    expect(openGaps().length).toBeGreaterThanOrEqual(6);
  });

  it('Capability Matrix: 今日の配置=NOT_ANSWERABLE等をデータ実態から判定する', async () => {
    const dataset = await repository.getDataset(ASOF);
    const emptyOps = { ...dataset, assignments: [], dailyReports: [], cashAccounts: [] };
    const caps = assessCapabilities(emptyOps);
    expect(caps.find((c) => c.key === 'customer_search')?.status).toBe('ANSWERABLE');
    expect(caps.find((c) => c.key === 'today_assignments')?.status).toBe('NOT_ANSWERABLE');
    expect(caps.find((c) => c.key === 'cash_forecast')?.status).toBe('NOT_ANSWERABLE');
    expect(caps.find((c) => c.key === 'pnl')?.status).toBe('NOT_ANSWERABLE');
    expect(caps.find((c) => c.key === 'today_assignments')?.missingGaps).toContain('DG-002');
  });

  it('Provider Configuration: API Key未設定はNOT_CONFIGUREDの正常状態として扱う', () => {
    const registry = createDefaultRegistry({});
    const views = registry.describe();
    const deterministic = views.find((v) => v.providerId === 'deterministic');
    expect(deterministic?.status).toBe('READY');
    expect(deterministic?.dataPolicy).toBe('SENSITIVE_ALLOWED');
    const anthropic = views.find((v) => v.providerId === 'anthropic');
    expect(anthropic?.status).toBe('NOT_CONFIGURED');
    expect(anthropic?.available).toBe(false);

    const configured = createDefaultRegistry({ ANTHROPIC_API_KEY: 'sk-test' });
    configured.recordOutcome('anthropic', false, '2026-08-08T00:00:00Z');
    const view = configured.describe().find((v) => v.providerId === 'anthropic');
    expect(view?.status).toBe('READY');
    expect(view?.health.lastFailure).toBe('2026-08-08T00:00:00Z');
  });

  it('Target Registry: CANDIDATE→承認でACTIVE、旧TargetはSUPERSEDEDで履歴保持', async () => {
    const service = new TargetRegistryService(repository);
    const president = { role: 'PRESIDENT' as const, companyIds: [], label: '社長' };

    const first = await service.registerCandidate(
      {
        companyId: 'lcc',
        departmentId: 'demolition',
        metric: 'MONTHLY_SALES',
        periodType: 'MONTH',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        value: 26_300_000,
        unit: 'JPY',
        source: '経営管理第13期シート（仮値・候補）',
        validFrom: '2026-08-01'
      },
      ASOF
    );
    expect(first.status).toBe('CANDIDATE');

    // STAFF は承認できない（RBAC）
    await expect(
      service.approve(first.targetId, { role: 'STAFF', companyIds: ['lcc'], label: '担当' }, ASOF)
    ).rejects.toThrow('承認できません');

    const active = await service.approve(first.targetId, president, ASOF);
    expect(active.status).toBe('ACTIVE');
    expect(active.approvedBy).toBe('社長');

    // 同一metric×期間の新Targetを承認すると旧TargetはSUPERSEDED
    const second = await service.registerCandidate(
      {
        companyId: 'lcc',
        departmentId: 'demolition',
        metric: 'MONTHLY_SALES',
        periodType: 'MONTH',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        value: 28_000_000,
        unit: 'JPY',
        source: '会話での指示',
        validFrom: '2026-08-01'
      },
      ASOF
    );
    await service.approve(second.targetId, president, ASOF);
    const all = await service.list();
    expect(all.find((t) => t.targetId === first.targetId)?.status).toBe('SUPERSEDED');
    expect(all.find((t) => t.targetId === first.targetId)?.supersededBy).toBe(second.targetId);
    const activeNow = await service.activeTargets(ASOF);
    expect(activeNow).toHaveLength(1);
    expect(activeNow[0].value).toBe(28_000_000);
  });

  it('Target API: 承認でDecision Memoryが残り、Registryが数値の正になる（§15）', async () => {
    const app = createCommandApp({ repository, llmHooks: {} });
    const created = await app.request('/targets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        companyId: 'lcc',
        metric: 'GROSS_MARGIN',
        periodType: 'FISCAL_YEAR',
        periodStart: '2026-08-01',
        periodEnd: '2027-07-31',
        value: 35,
        unit: 'PERCENT',
        source: '会話での指示'
      })
    });
    expect(created.status).toBe(201);
    const target = (await created.json()) as { targetId: string; status: string };
    expect(target.status).toBe('CANDIDATE');

    const approved = await app.request(`/targets/${target.targetId}/approve`, { method: 'POST' });
    expect(approved.status).toBe(200);
    const memories = await repository.getMemories();
    const decision = memories.find(
      (m) => m.type === 'DECISION' && m.statement.includes('経営目標を承認')
    );
    expect(decision?.reviewStatus).toBe('CONFIRMED_BY_USER');
    expect(decision?.sourceId).toBe(target.targetId);
  });

  it('Event Bus: 会話でAI_THINKING→ANSWER_COMPLETEDが流れ、AI CORE状態が導出される', async () => {
    const bus = new CommandEventBus();
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.event));
    const orchestrator = new CommandOrchestrator(repository, { eventBus: bus });
    await orchestrator.chat({ message: '今月どう？', scope: 'lcc', asOf: ASOF, sessionId: 'vui' });
    expect(seen[0]).toBe('AI_THINKING');
    expect(seen).toContain('ANSWER_COMPLETED');
    expect(bus.coreState().primaryState).toBe('IDLE');

    bus.emit({ event: 'ROLE_STARTED', role: 'FINANCE', displayLabel: '資金状況を分析中' });
    const state = bus.coreState();
    expect(state.activeRoles).toContain('FINANCE');
    const last = bus.recent(1)[0];
    expect(last.displayLabel).toBe('資金状況を分析中');
  });

  it('複数Role Plan実行でROLE_STARTED/COMPLETEDイベントがAgentTraceから発行される（§19）', async () => {
    const bus = new CommandEventBus();
    const orchestrator = new CommandOrchestrator(repository, { eventBus: bus });
    await orchestrator.chat({
      message: 'この新規事業をやるべきか、競合と市場も調べて、収益モデルと実行計画を作って',
      scope: 'lcc',
      asOf: ASOF,
      sessionId: 'vui2'
    });
    const events = bus.recent(200);
    expect(events.some((e) => e.event === 'PLAN_CREATED')).toBe(true);
    const roleStarts = events.filter((e) => e.event === 'ROLE_STARTED');
    expect(roleStarts.length).toBeGreaterThanOrEqual(4);
    expect(roleStarts.every((e) => e.role && e.displayLabel)).toBe(true);
    // Provider名はEventへ流さない
    expect(JSON.stringify(events)).not.toContain('anthropic');
  });

  it('Generative UI Schema: /chatがui（components/suggestedActions）を返す（§23-§25）', async () => {
    const app = createCommandApp({ repository, llmHooks: {} });
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '今月どう？', scope: 'lcc', asOf: ASOF })
    });
    const body = (await res.json()) as {
      text: string;
      ui: {
        message: string;
        components: Array<{ type: string }>;
        suggestedActions: Array<{ label: string; message: string }>;
      };
    };
    expect(body.ui.message).toBe(body.text);
    expect(body.ui.components.some((c) => c.type === 'EVIDENCE')).toBe(true);
    expect(body.ui.suggestedActions.some((a) => a.label === '根拠を見る')).toBe(true);
    expect(body.ui.suggestedActions.some((a) => a.label === '覚えて')).toBe(true);
  });

  it('uiSchema: 承認付き回答はAPPROVALコンポーネントになる', () => {
    const ui = buildUiResponse({
      text: '送信下書きを作成しました',
      dataStatus: 'OK',
      uiHint: 'text',
      confidence: 'HIGH',
      evidence: [],
      toolsUsed: [],
      approvalRequest: {
        approvalId: 'apr-1'
      } as never
    });
    expect(ui.components.some((c) => c.type === 'APPROVAL')).toBe(true);
  });

  it('Hallucination Gate: 存在しない案件・顧客・金額・Decisionへ捏造せず正直に返す（§30）', async () => {
    const orchestrator = new CommandOrchestrator(repository);
    const report = await runRealEvaluation(HALLUCINATION_PROBES, (question, scope) =>
      orchestrator.chat({ message: question, scope, asOf: ASOF, sessionId: 'halluc' })
    );
    expect(report.hallucinationProbes).toBe(HALLUCINATION_PROBES.length);
    expect(report.hallucinationFailures).toBe(0);
    expect(report.records.every((r) => !r.hallucination)).toBe(true);
  });

  it('GET /data-gaps /capabilities /providers /events /core-state が応答する', async () => {
    const app = createCommandApp({ repository, llmHooks: {} });
    const gaps = (await (await app.request('/data-gaps')).json()) as { gaps: unknown[] };
    expect(gaps.gaps.length).toBeGreaterThanOrEqual(7);
    const caps = (await (
      await app.request(`/capabilities?scope=lcc&asOf=${encodeURIComponent(ASOF)}`)
    ).json()) as { capabilities: unknown[] };
    expect(caps.capabilities.length).toBeGreaterThanOrEqual(9);
    const providers = (await (await app.request('/providers')).json()) as {
      providers: Array<{ providerId: string; status: string }>;
    };
    expect(providers.providers.length).toBeGreaterThanOrEqual(4);
    await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '今月どう？', scope: 'lcc', asOf: ASOF })
    });
    const events = (await (await app.request('/events')).json()) as { events: unknown[] };
    expect(events.events.length).toBeGreaterThan(0);
    const core = (await (await app.request('/core-state')).json()) as { primaryState: string };
    expect(core.primaryState).toBe('IDLE');
  });
});
