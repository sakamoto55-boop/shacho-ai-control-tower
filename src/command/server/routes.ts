/**
 * LCC COMMAND のHTTPルート。既存の社長AI管制塔サーバー（Hono）へ /command 配下でマウントする。
 * 会話（chat）を中心に、KPI・Brief・資金繰り・アラート・承認・経営判断Memoryを公開する。
 */
import { Hono } from 'hono';
import type {
  CashScenarioAdjustment,
  CommandChatRequest,
  CompanyScope,
  Decision
} from '../domain/types.js';
import { nowIso } from '../../utils/date.js';
import { CommandOrchestrator } from '../orchestrator/orchestrator.js';
import type { CommandRepository } from '../repositories/CommandRepository.js';
import { LocalCommandRepository } from '../repositories/CommandRepository.js';
import { buildAlerts } from '../engines/alerts.js';
import { computeCashForecast } from '../engines/cashForecast.js';
import { computeKpiSnapshot } from '../engines/kpi.js';
import { generateExecutiveBrief } from '../brief/generateBrief.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCommandApp(
  repository: CommandRepository = new LocalCommandRepository()
): Hono {
  const app = new Hono();
  const orchestrator = new CommandOrchestrator(repository);

  const readScope = (value: string | undefined): CompanyScope =>
    value && value.length > 0 ? value : 'group';

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'lcc-command',
      phase: 'A',
      voice: 'mock',
      modelRouter: 'mock',
      timestamp: nowIso()
    })
  );

  app.post('/chat', async (c) => {
    try {
      const body = (await c.req.json()) as CommandChatRequest;
      if (!body.message || body.message.trim().length === 0) throw new Error('message is required');
      const response = await orchestrator.chat(body);
      return c.json(response);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get('/kpi', async (c) => {
    const scope = readScope(c.req.query('scope'));
    const asOf = c.req.query('asOf') ?? nowIso();
    const dataset = await repository.getDataset(asOf);
    const store = await repository.getStore();
    return c.json(computeKpiSnapshot(dataset, scope, buildAlerts(dataset, scope, store.decisions)));
  });

  app.get('/brief', async (c) => {
    const scope = readScope(c.req.query('scope'));
    const asOf = c.req.query('asOf') ?? nowIso();
    const dataset = await repository.getDataset(asOf);
    const store = await repository.getStore();
    return c.json(generateExecutiveBrief(dataset, scope, store.decisions));
  });

  app.get('/cash/forecast', async (c) => {
    const scope = readScope(c.req.query('scope'));
    const asOf = c.req.query('asOf') ?? nowIso();
    const dataset = await repository.getDataset(asOf);
    return c.json(computeCashForecast(dataset, scope));
  });

  app.post('/cash/scenario', async (c) => {
    try {
      const body = (await c.req.json()) as {
        scope?: CompanyScope;
        asOf?: string;
        adjustments: CashScenarioAdjustment[];
      };
      const asOf = body.asOf ?? nowIso();
      const dataset = await repository.getDataset(asOf);
      const scope = body.scope ?? 'group';
      return c.json({
        base: computeCashForecast(dataset, scope),
        scenario: computeCashForecast(dataset, scope, body.adjustments ?? [])
      });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get('/alerts', async (c) => {
    const scope = readScope(c.req.query('scope'));
    const asOf = c.req.query('asOf') ?? nowIso();
    const dataset = await repository.getDataset(asOf);
    const store = await repository.getStore();
    return c.json({ alerts: buildAlerts(dataset, scope, store.decisions) });
  });

  app.get('/approvals', async (c) => {
    const store = await repository.getStore();
    return c.json({ approvals: store.approvals });
  });

  app.post('/approvals/:id/approve', async (c) => {
    // 承認されても Phase A は実送信・実変更を行わない（dry-run固定）
    const approval = await repository.updateApproval(c.req.param('id'), {
      status: 'executed_dry_run',
      decidedAt: nowIso(),
      executionResult:
        '承認済み。Phase Aのためdry-runで完了（外部への実送信・実変更は行っていません）。'
    });
    if (!approval) return c.json({ error: 'approval not found' }, 404);
    return c.json(approval);
  });

  app.post('/approvals/:id/reject', async (c) => {
    const approval = await repository.updateApproval(c.req.param('id'), {
      status: 'rejected',
      decidedAt: nowIso()
    });
    if (!approval) return c.json({ error: 'approval not found' }, 404);
    return c.json(approval);
  });

  app.get('/decisions', async (c) => {
    const store = await repository.getStore();
    return c.json({ decisions: store.decisions });
  });

  app.post('/decisions', async (c) => {
    try {
      const body = (await c.req.json()) as Partial<Decision>;
      if (!body.decision || !body.companyId) throw new Error('decision and companyId are required');
      const decision: Decision = {
        decisionId: body.decisionId ?? `dec-${Date.now()}`,
        companyId: body.companyId,
        projectId: body.projectId,
        date: body.date ?? nowIso().slice(0, 10),
        decision: body.decision,
        reason: body.reason ?? '',
        decisionMaker: body.decisionMaker ?? '社長',
        validUntil: body.validUntil,
        status: body.status ?? 'active',
        suppressAlertKinds: body.suppressAlertKinds
      };
      return c.json(await repository.saveDecision(decision));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get('/tasks', async (c) => {
    const store = await repository.getStore();
    return c.json({ tasks: store.tasks });
  });

  app.get('/research', async (c) => {
    const store = await repository.getStore();
    return c.json({ research: store.research });
  });

  return app;
}
