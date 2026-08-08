/**
 * LCC COMMAND のHTTPルート。既存の社長AI管制塔サーバー（Hono）へ /command 配下でマウントする。
 *
 * セキュリティ方針:
 * - RBACはAPI側で強制する（UIで隠すだけの制御は禁止）。全ルートでPrincipal解決→スコープ検査。
 * - Tool引数はValidationを通す。Rate Limitを掛ける。操作はAudit Logへ記録する（機微情報マスク）。
 * - productionモードで実データが無い場合、デモデータへはフォールバックしない（DATA UNAVAILABLE）。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Decision, Principal } from '../domain/types.js';
import { nowIso } from '../../utils/date.js';
import { CommandOrchestrator } from '../orchestrator/orchestrator.js';
import type { CommandRepository } from '../repositories/CommandRepository.js';
import { createCommandRepository } from '../repositories/CommandRepository.js';
import { buildAlerts } from '../engines/alerts.js';
import { computeCashForecast, diffCashForecast } from '../engines/cashForecast.js';
import { computeKpiSnapshot } from '../engines/kpi.js';
import { generateExecutiveBrief } from '../brief/generateBrief.js';
import { datasetAvailability } from '../sources/SourceAdapter.js';
import {
  AccessDeniedError,
  assertScopeAllowed,
  canDecideApproval,
  canRecordDecision,
  resolvePrincipal
} from '../domain/rbac.js';
import {
  RateLimiter,
  ValidationError,
  validateAsOf,
  validateMessage,
  validateScenarioAdjustments,
  validateScope
} from '../security/security.js';
import { AuditLog } from '../security/audit.js';
import { addDaysJst, jstDate } from '../utils/jst.js';
import { checkDataQuality } from '../domain/dataQuality.js';
import {
  createGoogleAuthenticatorFromEnv,
  type GoogleIdentityAuthenticator
} from '../auth/googleIdentity.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface CommandAppOptions {
  repository?: CommandRepository;
  auditLog?: AuditLog;
  rateLimiter?: RateLimiter;
  /** テスト注入用。未指定時は LCC_COMMAND_API_TOKENS 環境変数を使う */
  apiTokens?: string;
  /** Google Identity認証（設定時はIDトークン検証を優先。認可＝RBACは共通） */
  googleAuthenticator?: GoogleIdentityAuthenticator | null;
}

export type CommandApp = Hono<{ Variables: { principal: Principal } }>;

export function createCommandApp(
  repositoryOrOptions?: CommandRepository | CommandAppOptions
): CommandApp {
  const options: CommandAppOptions =
    repositoryOrOptions && 'getDataset' in repositoryOrOptions
      ? { repository: repositoryOrOptions }
      : (repositoryOrOptions ?? {});
  const repository = options.repository ?? createCommandRepository();
  const audit = options.auditLog ?? new AuditLog();
  const rateLimiter = options.rateLimiter ?? new RateLimiter();
  const googleAuth =
    options.googleAuthenticator !== undefined
      ? options.googleAuthenticator
      : createGoogleAuthenticatorFromEnv();
  const app = new Hono<{ Variables: { principal: Principal } }>();
  const orchestrator = new CommandOrchestrator(repository);

  // --- Principal解決 + Rate Limit（全ルート共通） ---
  app.use('*', async (c, next) => {
    const clientKey = c.req.header('x-forwarded-for') ?? 'local';
    if (!rateLimiter.allow(clientKey)) {
      return c.json({ error: 'rate limit exceeded' }, 429);
    }
    // Authentication: Google Identity（設定時）→ 静的トークン の順。Authorization(RBAC)は共通。
    const principal = googleAuth
      ? await googleAuth.authenticate(c.req.header('authorization'))
      : resolvePrincipal(
          c.req.header('authorization'),
          repository.mode,
          options.apiTokens ?? process.env.LCC_COMMAND_API_TOKENS
        );
    if (!principal) {
      return c.json({ error: 'unauthorized: 有効な認証情報が必要です' }, 401);
    }
    c.set('principal', principal);
    await next();
  });

  const handleError = (c: Context, error: unknown) => {
    if (error instanceof AccessDeniedError) return c.json({ error: error.message }, 403);
    if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
    return c.json({ error: errorMessage(error) }, 400);
  };

  const scopedDataset = async (c: Context<{ Variables: { principal: Principal } }>) => {
    const scope = validateScope(c.req.query('scope'));
    const asOf = validateAsOf(c.req.query('asOf')) ?? nowIso();
    assertScopeAllowed(c.get('principal'), scope);
    const dataset = await repository.getDataset(asOf);
    const store = await repository.getStore();
    return { scope, asOf, dataset, store };
  };

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'lcc-command',
      phase: 'A',
      mode: repository.mode,
      voice: 'mock',
      modelRouter: 'mock',
      timestamp: nowIso()
    })
  );

  app.post('/chat', async (c) => {
    const principal = c.get('principal');
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const message = validateMessage(body.message);
      const scope = body.scope === undefined ? undefined : validateScope(body.scope);
      const asOf = validateAsOf(body.asOf);
      const sessionId =
        typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : undefined;
      const response = await orchestrator.chat({ message, scope, asOf, sessionId }, principal);
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'chat',
        scope: scope ?? 'context',
        detail: message,
        outcome: 'ok'
      });
      return c.json(response);
    } catch (error) {
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'chat',
        scope: 'unknown',
        detail: errorMessage(error),
        outcome: error instanceof AccessDeniedError ? 'denied' : 'error'
      });
      return handleError(c, error);
    }
  });

  app.get('/kpi', async (c) => {
    try {
      const { scope, dataset, store } = await scopedDataset(c);
      return c.json(
        computeKpiSnapshot(dataset, scope, buildAlerts(dataset, scope, store.decisions))
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/brief', async (c) => {
    try {
      const { scope, dataset, store } = await scopedDataset(c);
      if (datasetAvailability(dataset) === 'DATA_UNAVAILABLE') {
        return c.json(
          { error: 'DATA UNAVAILABLE: 実データソース未接続のためBriefを生成できません' },
          503
        );
      }
      return c.json(generateExecutiveBrief(dataset, scope, store.decisions));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/cash/forecast', async (c) => {
    try {
      const { scope, dataset } = await scopedDataset(c);
      if (datasetAvailability(dataset) === 'DATA_UNAVAILABLE') {
        return c.json(
          { error: 'DATA UNAVAILABLE: 実データソース未接続のため資金繰りを計算できません' },
          503
        );
      }
      return c.json(computeCashForecast(dataset, scope));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/cash/scenario', async (c) => {
    try {
      const principal = c.get('principal');
      const body = (await c.req.json()) as Record<string, unknown>;
      const scope = validateScope(body.scope);
      const asOf = validateAsOf(body.asOf) ?? nowIso();
      const adjustments = validateScenarioAdjustments(body.adjustments);
      assertScopeAllowed(principal, scope);
      const dataset = await repository.getDataset(asOf);
      if (datasetAvailability(dataset) === 'DATA_UNAVAILABLE') {
        return c.json(
          { error: 'DATA UNAVAILABLE: 実データソース未接続のためシナリオを計算できません' },
          503
        );
      }
      const base = computeCashForecast(dataset, scope);
      const scenario = computeCashForecast(dataset, scope, adjustments);
      return c.json({ base, scenario, diff: diffCashForecast(base, scenario) });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/alerts', async (c) => {
    try {
      const { scope, dataset, store } = await scopedDataset(c);
      return c.json({ alerts: buildAlerts(dataset, scope, store.decisions) });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/approvals', async (c) => {
    const principal = c.get('principal');
    const store = await repository.getStore();
    // 承認一覧も法人スコープで絞る（担当法人以外の承認は見せない）
    const approvals = store.approvals.filter((approval) => {
      try {
        assertScopeAllowed(principal, approval.companyId);
        return true;
      } catch {
        return false;
      }
    });
    return c.json({ approvals });
  });

  app.post('/approvals/:id/approve', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}に承認権限がありません`);
      }
      const store = await repository.getStore();
      const existing = store.approvals.find((item) => item.approvalId === c.req.param('id'));
      if (!existing) return c.json({ error: 'approval not found' }, 404);
      assertScopeAllowed(principal, existing.companyId);
      // Idempotency: 既に確定済みの承認は再実行しない
      if (existing.status !== 'waiting') return c.json(existing);
      const approval = await repository.updateApproval(existing.approvalId, {
        status: 'executed_dry_run',
        decidedAt: nowIso(),
        executionResult:
          '承認済み。Phase Aのためdry-runで完了（外部への実送信・実変更は行っていません）。'
      });
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'approval.approve',
        scope: existing.companyId,
        detail: `${existing.action} -> ${existing.target}`,
        outcome: 'ok'
      });
      return c.json(approval);
    } catch (error) {
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'approval.approve',
        scope: 'unknown',
        detail: errorMessage(error),
        outcome: 'denied'
      });
      return handleError(c, error);
    }
  });

  app.post('/approvals/:id/reject', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}に承認権限がありません`);
      }
      const store = await repository.getStore();
      const existing = store.approvals.find((item) => item.approvalId === c.req.param('id'));
      if (!existing) return c.json({ error: 'approval not found' }, 404);
      assertScopeAllowed(principal, existing.companyId);
      if (existing.status !== 'waiting') return c.json(existing);
      const approval = await repository.updateApproval(existing.approvalId, {
        status: 'rejected',
        decidedAt: nowIso()
      });
      return c.json(approval);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/decisions', async (c) => {
    const store = await repository.getStore();
    return c.json({ decisions: store.decisions });
  });

  app.post('/decisions', async (c) => {
    const principal = c.get('principal');
    try {
      // Decision（経営判断Memory）は人間の判断のみ。AI/SYSTEMは登録できない。
      if (!canRecordDecision(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はDecisionを登録できません`);
      }
      const body = (await c.req.json()) as Partial<Decision>;
      if (!body.decision || !body.companyId)
        throw new ValidationError('decisionとcompanyIdは必須です');
      if (!body.reason) throw new ValidationError('reason（判断理由）は必須です');
      if (!body.decisionMaker) throw new ValidationError('decisionMaker（判断者）は必須です');
      if (!body.validUntil)
        throw new ValidationError(
          'validUntil（有効期限）は必須です。無期限のDecisionは登録できません'
        );
      assertScopeAllowed(principal, body.companyId);
      const today = jstDate(nowIso());
      if (body.validUntil <= today)
        throw new ValidationError('validUntilは未来日である必要があります');
      if (body.validUntil > addDaysJst(today, 180)) {
        throw new ValidationError(
          'validUntilは180日以内にしてください（長期抑制は再登録で更新する運用）'
        );
      }
      const decision: Decision = {
        decisionId: body.decisionId ?? `dec-${Date.now()}`,
        companyId: body.companyId,
        projectId: body.projectId,
        date: body.date ?? today,
        decision: body.decision,
        reason: body.reason,
        decisionMaker: body.decisionMaker,
        validUntil: body.validUntil,
        status: body.status ?? 'active',
        suppressAlertKinds: body.suppressAlertKinds
      };
      const saved = await repository.saveDecision(decision);
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'decision.save',
        scope: decision.companyId,
        detail: decision.decision,
        outcome: 'ok'
      });
      return c.json(saved);
    } catch (error) {
      return handleError(c, error);
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

  app.get('/data-quality', async (c) => {
    // データ不整合の検出結果（Phase B0は検出のみ。自動修正しない）
    try {
      const { scope, dataset } = await scopedDataset(c);
      return c.json({ scope, issues: checkDataQuality(dataset, scope) });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/sources', async (c) => {
    // Source別の接続状態（lastSuccessfulSync / freshness / errorState）を公開する
    const asOf = validateAsOf(c.req.query('asOf')) ?? nowIso();
    const dataset = await repository.getDataset(asOf);
    return c.json({
      mode: repository.mode,
      availability: datasetAvailability(dataset),
      sources: dataset.meta.sources
    });
  });

  return app;
}
