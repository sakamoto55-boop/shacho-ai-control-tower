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
        reason: '顧客との完工約束を優先する',
        decisionMaker: '社長',
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

  // --- Phase GROWTH ---

  it('GET /growth/backlog がGrowthアイテムと上位提案を返す', async () => {
    const res = await app.request('/growth/backlog');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; topProposals: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.topProposals.length).toBeLessThanOrEqual(2);
  });

  it('GET /growth/self-evaluation はサンプルなしを正直に返す（§41）', async () => {
    const res = await app.request('/growth/self-evaluation');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      evaluation: { sampleSize: number; compositeScore: number | null; note: string };
    };
    expect(body.evaluation.sampleSize).toBe(0);
    expect(body.evaluation.compositeScore).toBeNull();
    expect(body.evaluation.note).toContain('効果測定できていません');
  });

  it('GET /growth/review は daily/weekly/monthly を返し、不正periodは400', async () => {
    for (const period of ['daily', 'weekly', 'monthly'] as const) {
      const res = await app.request(`/growth/review?period=${period}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { text: string };
      expect(body.text.length).toBeGreaterThan(10);
    }
    const bad = await app.request('/growth/review?period=yearly');
    expect(bad.status).toBe(400);
  });

  it('STAFFはGrowth Backlog・自己評価を参照できない（RBAC）', async () => {
    const tokens = JSON.stringify({
      'tok-staff': { role: 'STAFF', companyIds: ['lcc'], label: 'スタッフ' }
    });
    const guarded = createCommandApp({ repository: new InMemoryCommandRepository(), apiTokens: tokens });
    for (const path of ['/growth/backlog', '/growth/self-evaluation', '/growth/review']) {
      const res = await guarded.request(path, {
        headers: { authorization: 'Bearer tok-staff' }
      });
      expect(res.status, path).toBe(403);
    }
  });
});
