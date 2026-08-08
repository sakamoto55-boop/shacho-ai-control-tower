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
import { MemoryService } from '../memory/store.js';
import type { MemoryLayer, MemoryType } from '../memory/types.js';
import {
  buildExperiment,
  completeExperiment,
  runMemoryMaintenance
} from '../memory/maintenance.js';
import {
  createGoogleAuthenticatorFromEnv,
  type GoogleIdentityAuthenticator
} from '../auth/googleIdentity.js';
import { ObservabilityLog } from '../observability/observability.js';
import { createLlmHooksFromEnv, type LlmHooks } from '../ai/llmHooks.js';
import { CommandEventBus } from '../events/eventBus.js';
import { buildUiResponse } from '../domain/uiSchema.js';
import { DATA_GAPS } from '../domain/dataGaps.js';
import { assessCapabilities } from '../domain/capability.js';
import { createDefaultRegistry } from '../agents/providerRegistry.js';
import { TargetRegistryService, type NewTargetInput } from '../targets/targetRegistry.js';

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
  /** 会話メタデータ・フィードバックの記録先（未指定時は自動生成） */
  observabilityLog?: ObservabilityLog;
  /** Phase B1: LLMフックの注入（テスト用。未指定時はANTHROPIC_API_KEYから自動生成） */
  llmHooks?: LlmHooks;
  /** Phase VUI用Event Bus（未指定時は自動生成） */
  eventBus?: CommandEventBus;
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
  const observability = options.observabilityLog ?? new ObservabilityLog();
  const llmHooks = options.llmHooks ?? createLlmHooksFromEnv();
  const eventBus = options.eventBus ?? new CommandEventBus();
  const orchestrator = new CommandOrchestrator(repository, {
    curatorExtractor: llmHooks.curatorExtractor,
    criticAdvisor: llmHooks.criticAdvisor,
    observability,
    eventBus
  });
  const memoryService = new MemoryService(repository);
  const targetService = new TargetRegistryService(repository);
  const providerRegistry = createDefaultRegistry();

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
      // Generative UI Schema（§23-§24）。既存フィールドは互換のまま ui を追加
      return c.json({ ...response, ui: buildUiResponse(response) });
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

  // --- Persistent Memory（Phase M）。Memory Audit UIのバックエンド ---
  app.get('/memory/maintenance', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はMemoryメンテナンスを実行できません`);
      }
      const asOf = validateAsOf(c.req.query('asOf')) ?? nowIso();
      const dataset = await repository.getDataset(asOf);
      return c.json(await runMemoryMaintenance(repository, asOf, dataset));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/memory', async (c) => {
    const principal = c.get('principal');
    try {
      const results = await memoryService.search(
        {
          q: c.req.query('q') || undefined,
          type: (c.req.query('type') as MemoryType) || undefined,
          layer: (c.req.query('layer') as MemoryLayer) || undefined,
          validAt: validateAsOf(c.req.query('validAt')),
          includeInactive: c.req.query('includeInactive') === 'true',
          limit: Math.min(Number(c.req.query('limit') ?? 20), 100)
        },
        principal
      );
      return c.json({ memories: results });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/memory/:id/confirm', async (c) => {
    const principal = c.get('principal');
    try {
      // AI抽出の判断候補を正式確定できるのは人間（PRESIDENT/EXECUTIVE）のみ
      if (!canRecordDecision(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はMemoryを確定できません`);
      }
      const memories = await repository.getMemories();
      const memory = memories.find((m) => m.memoryId === c.req.param('id'));
      if (!memory) return c.json({ error: 'memory not found' }, 404);
      assertScopeAllowed(principal, memory.companyId);
      memory.reviewStatus = 'CONFIRMED_BY_USER';
      if (memory.type === 'DECISION') memory.confidence = 'CONFIRMED';
      memory.updatedAt = nowIso();
      await repository.saveMemory(memory);
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'memory.confirm',
        scope: memory.companyId,
        detail: memory.statement,
        outcome: 'ok'
      });
      return c.json(memory);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/memory/:id/archive', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canRecordDecision(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はMemoryをアーカイブできません`);
      }
      const memory = await memoryService.archive(c.req.param('id'), nowIso());
      return c.json(memory);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/memory/conflicts/resolve', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canRecordDecision(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はConflictを解決できません`);
      }
      const body = (await c.req.json()) as { keepId?: string; supersedeId?: string; note?: string };
      if (!body.keepId || !body.supersedeId)
        throw new ValidationError('keepIdとsupersedeIdが必要です');
      await memoryService.resolveConflict(
        body.keepId,
        body.supersedeId,
        nowIso(),
        body.note ?? 'ユーザー判断'
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // --- Experiment Engine（提案して終わりにしない） ---
  app.get('/experiments', async (c) => {
    return c.json({ experiments: await repository.getExperiments() });
  });

  app.post('/experiments', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canRecordDecision(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}は実験を登録できません`);
      }
      const body = (await c.req.json()) as Record<string, string>;
      for (const field of ['companyId', 'hypothesis', 'metric', 'baseline', 'target']) {
        if (!body[field]) throw new ValidationError(`${field}は必須です`);
      }
      assertScopeAllowed(principal, body.companyId);
      const experiment = buildExperiment(
        {
          companyId: body.companyId,
          hypothesis: body.hypothesis,
          metric: body.metric,
          baseline: body.baseline,
          target: body.target,
          plannedEndAt: body.plannedEndAt
        },
        `user:${principal.label}`,
        nowIso()
      );
      return c.json(await repository.saveExperiment(experiment));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/experiments/:id/result', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canRecordDecision(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}は実験結果を登録できません`);
      }
      const body = (await c.req.json()) as { result?: string; evaluation?: string };
      if (!body.result || !body.evaluation)
        throw new ValidationError('resultとevaluationが必要です');
      const experiments = await repository.getExperiments();
      const experiment = experiments.find((e) => e.experimentId === c.req.param('id'));
      if (!experiment) return c.json({ error: 'experiment not found' }, 404);
      assertScopeAllowed(principal, experiment.companyId);
      const now = nowIso();
      const { experiment: completed, lessonStatement } = completeExperiment(
        experiment,
        body.result,
        body.evaluation,
        now
      );
      await repository.saveExperiment(completed);
      // 成功・失敗の両方をLESSONとして会社Memoryへ戻す
      const lesson = await memoryService.save(
        {
          type: 'LESSON',
          statement: lessonStatement,
          entities: [],
          relations: completed.hypothesisMemoryId
            ? [{ kind: 'validates', targetMemoryId: completed.hypothesisMemoryId }]
            : [],
          layer: 'COMPANY',
          sensitivity: 'NORMAL',
          companyId: completed.companyId,
          source: 'SYSTEM',
          sourceId: completed.experimentId,
          sourceTimestamp: now,
          validFrom: now.slice(0, 10),
          confidence: 'HIGH',
          createdBy: `user:${principal.label}`,
          reviewStatus: 'CONFIRMED_BY_USER',
          evidence: [
            {
              label: '実験結果',
              value: `${completed.metric}: ${completed.baseline} → ${body.result}`,
              refId: completed.experimentId,
              source: 'Experiment Engine',
              asOf: now
            }
          ]
        },
        now
      );
      completed.lessonMemoryId = lesson.record.memoryId;
      await repository.saveExperiment(completed);
      return c.json({ experiment: completed, lesson: lesson.record });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // 回答フィードバック（§21）。改善の参考として保存するのみで、モデルの自動学習には使わない
  app.post('/feedback', async (c) => {
    const principal = c.get('principal');
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const rating = body.rating === 'good' || body.rating === 'bad' ? body.rating : null;
      if (!rating) throw new ValidationError('ratingは good | bad を指定してください');
      await observability.record({
        kind: 'feedback',
        actor: principal.label,
        sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : undefined,
        intent: typeof body.intent === 'string' ? body.intent.slice(0, 40) : undefined,
        rating,
        comment: typeof body.comment === 'string' ? body.comment.slice(0, 300) : undefined
      });
      return c.json({
        ok: true,
        note: 'フィードバックを保存しました（回答改善の参考に使います。モデルの自動学習には使いません）'
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Observability（§19-§20）。会話メタデータ・フィードバック・概算コストの参照
  app.get('/observability', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はObservabilityを参照できません`);
      }
      const limitRaw = Number(c.req.query('limit') ?? 50);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;
      return c.json({
        entries: observability.recent(limit),
        totalApproxTokens: observability.totalApproxTokens()
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // --- Phase B1.5: Data Gap / Capability / Provider / Target / Visual Event ---

  app.get('/data-gaps', (c) => c.json({ gaps: DATA_GAPS }));

  app.get('/capabilities', async (c) => {
    try {
      const { dataset } = await scopedDataset(c);
      return c.json({ capabilities: assessCapabilities(dataset) });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/providers', (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}はProvider設定を参照できません` }, 403);
    }
    return c.json({ providers: providerRegistry.describe() });
  });

  app.get('/targets', async (c) => {
    try {
      return c.json({ targets: await targetService.list() });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // 発見・提案された目標はCANDIDATEとしてのみ登録できる（§13）
  app.post('/targets', async (c) => {
    const principal = c.get('principal');
    try {
      const body = (await c.req.json()) as Partial<NewTargetInput>;
      if (
        !body.companyId ||
        !body.metric ||
        !body.periodStart ||
        !body.periodEnd ||
        typeof body.value !== 'number'
      ) {
        throw new ValidationError('companyId / metric / periodStart / periodEnd / value は必須です');
      }
      const now = nowIso();
      const record = await targetService.registerCandidate(
        {
          companyId: body.companyId,
          departmentId: body.departmentId ?? 'all',
          metric: body.metric,
          periodType: body.periodType ?? 'MONTH',
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          value: body.value,
          unit: body.unit ?? 'JPY',
          source: body.source ?? `API登録（${principal.label}）`,
          validFrom: body.validFrom ?? now.slice(0, 10),
          validUntil: body.validUntil,
          notes: body.notes
        },
        now
      );
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'target_candidate',
        scope: body.companyId,
        detail: `${body.metric} ${body.value}`,
        outcome: 'ok'
      });
      return c.json(record, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  // ユーザー承認でのみACTIVE化（§14）。旧TargetはSUPERSEDEDで履歴保持。Decision Memoryも残す（§15）
  app.post('/targets/:id/approve', async (c) => {
    const principal = c.get('principal');
    try {
      const now = nowIso();
      const approved = await targetService.approve(c.req.param('id'), principal, now);
      try {
        await memoryService.save(
          {
            type: 'DECISION',
            statement: `経営目標を承認: ${approved.metric} ${approved.value}${approved.unit === 'PERCENT' ? '%' : approved.unit === 'COUNT' ? '件' : '円'}（${approved.periodStart}〜${approved.periodEnd} / ${approved.departmentId}）`,
            entities: [],
            relations: [],
            layer: 'PRESIDENT',
            sensitivity: 'NORMAL',
            companyId: approved.companyId,
            source: 'SYSTEM',
            sourceId: approved.targetId,
            sourceTimestamp: now,
            validFrom: approved.validFrom,
            validUntil: approved.validUntil,
            confidence: 'CONFIRMED',
            createdBy: `user:${principal.label}`,
            reviewStatus: 'CONFIRMED_BY_USER',
            evidence: [
              {
                label: 'Target Registry',
                value: approved.targetId,
                source: 'Target Registry',
                asOf: now
              }
            ]
          },
          now
        );
      } catch {
        // Decision Memory保存失敗でもTarget承認自体は成立させる（Registryが正）
      }
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'target_approve',
        scope: approved.companyId,
        detail: approved.targetId,
        outcome: 'ok'
      });
      return c.json(approved);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/events', (c) => {
    const limitRaw = Number(c.req.query('limit') ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
    return c.json({ events: eventBus.recent(limit) });
  });

  app.get('/core-state', (c) => c.json(eventBus.coreState()));

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
