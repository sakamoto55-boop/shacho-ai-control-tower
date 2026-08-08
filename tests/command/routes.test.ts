import { beforeEach, describe, expect, it } from 'vitest';
import { createCommandApp } from '../../src/command/server/routes.js';
import { InMemoryCommandRepository } from '../../src/command/repositories/CommandRepository.js';
import { resetToolIdSeq } from '../../src/command/tools/registry.js';
import type { CommandChatResponse, KpiSnapshot } from '../../src/command/domain/types.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('/command API', () => {
  let app: ReturnType<typeof createCommandApp>;
  let repository: InMemoryCommandRepository;

  beforeEach(() => {
    resetToolIdSeq();
    repository = new InMemoryCommandRepository();
    app = createCommandApp(repository);
  });

  it('GET /health が稼働情報を返す', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service: string };
    expect(body.service).toBe('lcc-command');
  });

  it('POST /chat が会話回答を返す', async () => {
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '今月どう？', scope: 'lcc', asOf: ASOF })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CommandChatResponse;
    expect(body.text).toContain('着地予測');
    expect(body.evidence.length).toBeGreaterThan(0);
  });

  it('POST /chat は空メッセージを400にする', async () => {
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '' })
    });
    expect(res.status).toBe(400);
  });

  it('GET /kpi が9つの経営KPIを鮮度付きで返す', async () => {
    const res = await app.request(`/kpi?scope=lcc&asOf=${encodeURIComponent(ASOF)}`);
    const body = (await res.json()) as KpiSnapshot;
    expect(body.kpis).toHaveLength(9);
    expect(body.kpis.every((kpi) => kpi.freshness.lastUpdatedAt.length > 0)).toBe(true);
    expect(body.kpis.find((kpi) => kpi.key === 'cash_balance')?.value).toBe(15_500_000);
  });

  it('承認フロー: /chat の送信依頼 → /approvals → approve でdry-run実行', async () => {
    const chatRes = await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'それで送って', scope: 'lcc', asOf: ASOF })
    });
    const chat = (await chatRes.json()) as CommandChatResponse;
    const approvalId = chat.approvalRequest?.approvalId as string;
    expect(approvalId).toBeDefined();

    const approveRes = await app.request(`/approvals/${approvalId}/approve`, { method: 'POST' });
    expect(approveRes.status).toBe(200);
    const approved = (await approveRes.json()) as { status: string; executionResult: string };
    expect(approved.status).toBe('executed_dry_run');
    expect(approved.executionResult).toContain('dry-run');
  });

  it('POST /decisions で経営判断を保存しアラートを抑制する', async () => {
    const decisionRes = await app.request('/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        companyId: 'lcc',
        projectId: 'prj-a',
        decision: 'A案件は粗利より完工を優先',
        validUntil: '2026-08-20',
        suppressAlertKinds: ['margin_drop']
      })
    });
    expect(decisionRes.status).toBe(200);

    const alertsRes = await app.request(`/alerts?scope=lcc&asOf=${encodeURIComponent(ASOF)}`);
    const body = (await alertsRes.json()) as {
      alerts: Array<{ kind: string; suppressedByDecisionId?: string }>;
    };
    const marginAlert = body.alerts.find((alert) => alert.kind === 'margin_drop');
    expect(marginAlert?.suppressedByDecisionId).toBeDefined();
  });

  it('POST /cash/scenario がbaseとscenarioを返す', async () => {
    const res = await app.request('/cash/scenario', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'lcc',
        asOf: ASOF,
        adjustments: [{ kind: 'delay_entry', planId: 'cp-in-d', days: 15 }]
      })
    });
    const body = (await res.json()) as {
      base: { minBalance: { balance: number } };
      scenario: { minBalance: { balance: number } };
    };
    expect(body.scenario.minBalance.balance).toBeLessThan(body.base.minBalance.balance);
  });
});
