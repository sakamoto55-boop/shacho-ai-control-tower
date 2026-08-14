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
import { DevicePairingService, isPrivateAddress } from './devicePairing.js';
import { networkInterfaces } from 'node:os';

/** 現在のプライベートIPv4からiPhone接続URL候補を生成（IP直書き廃止・IP変更に自動追随） */
function lanPairUrls(): string[] {
  const urls: string[] = [];
  const port = process.env.PORT ?? '8787';
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && isPrivateAddress(a.address)) urls.push(`http://${a.address}:${port}/vui`);
    }
  }
  return urls;
}
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
import {
  ProviderVerificationService,
  createDefaultProber,
  type VerifiedProviderStatus
} from '../ai/providerVerification.js';
import { searchKnowledge } from '../integrations/knowledge/knowledgeSearch.js';
import { TargetRegistryService, type NewTargetInput } from '../targets/targetRegistry.js';
import { ConstitutionService } from '../constitution/constitutionRegistry.js';
import { computeFutureInsights } from '../future/futureEngine.js';
import {
  CAPABILITIES,
  availableProvidersFromEnv,
  capabilityStatus
} from '../capabilities/capabilityRegistry.js';
import { ArtifactService } from '../artifacts/artifactRegistry.js';
import { DATA_STEWARDSHIP } from '../domain/stewardship.js';
import { unifiedSearch } from '../search/unifiedSearch.js';
import { MemoryService as MemorySearchService } from '../memory/store.js';
import { GrowthService } from '../growth/growthBacklog.js';
import { PromotionPipeline } from '../growth/promotionPipeline.js';
import {
  buildDailyGrowthReview,
  buildMonthlyIntelligenceReview,
  buildWeeklyGrowthReview,
  type GrowthReviewInput
} from '../growth/growthReview.js';
import { IncidentService, type IncidentKind, type IncidentStatus } from '../livebeta/incidentLog.js';
import { evaluateBetaGate } from '../livebeta/betaGate.js';
import { computeAutonomyReview, computePresidentDecisionLoad } from '../growth/autonomyReview.js';
import { buildReviewSummary, bulkApprove } from '../constitution/reviewSummary.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

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
  /** 是正⑦: Provider実疎通検証（テスト注入用。未指定時はfetchベースの既定Prober） */
  providerVerification?: ProviderVerificationService;
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
  // 是正⑦: キー存在だけでACTIVE表示しない。実API疎通の結果を/providersへ反映する
  const providerVerification =
    options.providerVerification ??
    new ProviderVerificationService(createDefaultProber(), (providerId) =>
      availableProvidersFromEnv().has(providerId)
    );
  const constitutionService = new ConstitutionService(repository);
  const artifactService = new ArtifactService(repository);
  const growthService = new GrowthService(repository);
  const promotionPipeline = new PromotionPipeline(repository);
  const incidentService = new IncidentService(repository);

  // --- 端末ペアリング（iPhone接続。claimのみ認証前・LAN限定・使い捨てコード） ---
  const pairing = new DevicePairingService();
  app.post('/pair/claim', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket?.remoteAddress;
    const result = pairing.claim(body.code ?? '', remote);
    if (!result.ok) {
      const map = { INVALID: [401, 'コードが違います'], EXPIRED: [410, '期限が切れました。PCで新しいコードを表示してください'], LOCKED: [429, '試行回数を超えました。PCで新しいコードを表示してください'], NOT_LAN: [403, '同じWi-Fi（社内LAN）から接続してください'] } as const;
      const [status, message] = map[result.reason];
      return c.json({ error: message, reason: result.reason }, status);
    }
    // HttpOnlyセッション（URL・画面へ秘密を出さない）。LAN HTTP運用のためSecure属性は付けない（正直な制約）
    c.header('set-cookie', `lcc_session=${result.sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    return c.json({ ok: true, message: 'この端末を認証しました' });
  });
  const readSid = (c: Context) => /(?:^|;\s*)lcc_session=([^;]+)/.exec(c.req.header('cookie') ?? '')?.[1];

  // --- Principal解決 + Rate Limit（全ルート共通） ---
  app.use('*', async (c, next) => {
    const clientKey = c.req.header('x-forwarded-for') ?? 'local';
    if (!rateLimiter.allow(clientKey)) {
      return c.json({ error: 'rate limit exceeded' }, 429);
    }
    // 端末セッションcookie → Principalへ直接解決（tokenは保存していない）。Authorizationヘッダー優先
    const authHeader = c.req.header('authorization');
    const sessionPrincipal = authHeader ? null : pairing.resolveSession(readSid(c));
    // Authentication: Google Identity（設定時）→ 静的トークン → 端末セッション の順。Authorization(RBAC)は共通。
    const principal = sessionPrincipal
      ?? (googleAuth
        ? await googleAuth.authenticate(authHeader)
        : resolvePrincipal(
            authHeader,
            repository.mode,
            options.apiTokens ?? process.env.LCC_COMMAND_API_TOKENS
          ));
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

  // DIOS §7: queued止まりだったResearchTaskの実処理（Job Runner）。
  // 未設定ProviderはWAITING_PROVIDER/NOT_CONFIGUREDを正直に返す。外部AI回答は仮説扱いでAgentRunへ記録
  app.post('/research/run', async (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}は調査実行を指示できません` }, 403);
    }
    const { IntelligenceJobRunner, providersFromEnv } = await import('../intelligence/jobRunner.js');
    const { IntelligenceStore } = await import('../intelligence/store.js');
    const runner = new IntelligenceJobRunner({
      store: new IntelligenceStore(),
      saveResearch: (t) => repository.saveResearch(t),
      providers: await providersFromEnv()
    });
    const store = await repository.getStore();
    const results = await runner.runPending(store.research, Number(c.req.query('limit') ?? 3));
    return c.json({
      processed: results.length,
      results: results.map((r) => ({
        researchId: r.task.researchId, status: r.task.status,
        runStatus: r.run.status, provider: r.run.provider, trust: r.run.resultTrust
      }))
    });
  });

  // DIOS: AgentRun履歴（監査用。仮説/提案区分・Provider・所要を含む）
  app.get('/agent-runs', async (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}は実行履歴を参照できません` }, 403);
    }
    const { IntelligenceStore } = await import('../intelligence/store.js');
    return c.json({ runs: new IntelligenceStore().agentRuns().slice(-50) });
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

  // TRACK B: Knowledge Search V1（Vault横断検索。READ ONLY・Evidence必須・名称一致はLOW候補）
  app.get('/knowledge/search', (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}はKnowledge検索を利用できません` }, 403);
    }
    const q = c.req.query('q')?.trim();
    if (!q || q.length < 2) {
      return c.json({ error: 'クエリq（2文字以上）を指定してください' }, 400);
    }
    const source = c.req.query('source') ?? undefined;
    const limit = Math.min(Number(c.req.query('limit') ?? 20) || 20, 50);
    return c.json(searchKnowledge(q, { sourceKey: source, limit }));
  });

  // TRACK B: 統合連携の接続状態（最終同期・件数・エラー・freshness。秘密情報なし）
  app.get('/integrations', (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}は統合状態を参照できません` }, 403);
    }
    const statusPath = resolvePath(
      process.env.LCC_INTEGRATION_DATA_DIR ?? './data',
      'integration-status.json'
    );
    if (!existsSync(statusPath)) {
      return c.json({
        updatedAt: null,
        sources: {},
        note: 'まだ同期が実行されていません（npm run sync:all）'
      });
    }
    try {
      const parsed = JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
      return c.json(parsed);
    } catch {
      return c.json({ error: 'integration-status.jsonを読み取れません' }, 500);
    }
  });

  // REAL USE 75%: 接続ヘルス診断（正直分類語彙: LIVE_API/SHEET_INGESTED/MANUAL_IMPORT/NOT_CONNECTED/ERROR）
  // シート取込を本体API接続と表現しない。環境変数の存在だけではLIVE_APIにしない
  app.get('/health/connections', async (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}は接続診断を参照できません` }, 403);
    }
    const statusPath = resolvePath(
      process.env.LCC_INTEGRATION_DATA_DIR ?? './data',
      'integration-status.json'
    );
    const raw = existsSync(statusPath)
      ? (JSON.parse(readFileSync(statusPath, 'utf8')) as {
          updatedAt?: string;
          sources?: Record<string, { status: string; processed: number; imported: number; errors: string[]; lastSyncedAt?: string; note?: string }>;
        })
      : { sources: {} };
    const src = raw.sources ?? {};
    const pick = (key: string) => src[key] ?? null;
    const asEntry = (
      system: string,
      classification: string,
      base: { processed?: number; lastSyncedAt?: string; errors?: string[]; note?: string } | null,
      extraNote?: string
    ) => ({
      system,
      classification,
      records: base?.processed ?? 0,
      lastSyncedAt: base?.lastSyncedAt ?? null,
      errors: base?.errors ?? [],
      note: extraNote ?? base?.note ?? ''
    });
    const { DriveClient } = await import('../integrations/drive/driveClient.js');
    const driveClient = DriveClient.fromEnv();
    const driveCheck = driveClient ? await driveClient.checkConnection() : null;
    const connections = [
      asEntry('freee（人事労務API）', pick('freee-hr')?.status === 'LIVE_READ_ONLY' ? 'LIVE_API' : (pick('freee-hr')?.status ?? 'NOT_CONNECTED'), pick('freee-hr')),
      asEntry('デジタル配置板/BOARD（カンバン正本シート）', pick('sheets:lcc-integrated-db') ? 'SHEET_INGESTED' : 'NOT_CONNECTED', pick('sheets:lcc-integrated-db'), 'Sheets SA READ ONLY取込。本体API接続ではない'),
      asEntry('日報（AI読み取りシート）', pick('sheets:daily-report-ai') ? 'SHEET_INGESTED' : 'NOT_CONNECTED', pick('sheets:daily-report-ai'), 'Sheets SA READ ONLY取込。確定チェック済み行のみ実績候補'),
      asEntry('LINE WORKS（受信箱シート）', pick('sheets:lineworks-inbox') ? 'SHEET_INGESTED' : 'NOT_CONNECTED', pick('sheets:lineworks-inbox'), 'Webhook→シート経由の取込。本体API接続ではない'),
      asEntry('法定書類DB（DERIVED）', pick('sheets:lcc-case-db') ? 'SHEET_INGESTED' : 'NOT_CONNECTED', pick('sheets:lcc-case-db')),
      {
        system: 'Google Drive（資料検索）',
        classification: !driveCheck ? 'NOT_CONNECTED' : driveCheck.state === 'LIVE_API' ? 'LIVE_API' : 'ERROR',
        records: driveCheck?.state === 'LIVE_API' ? driveCheck.visibleFiles : 0,
        lastSyncedAt: driveCheck?.state === 'LIVE_API' ? driveCheck.checkedAt : null,
        errors: driveCheck && driveCheck.state === 'ERROR' ? [driveCheck.reason] : [],
        note:
          driveCheck && driveCheck.state === 'ERROR' && driveCheck.fix
            ? `解除方法: ${driveCheck.fix}`
            : driveCheck?.state === 'LIVE_API'
              ? 'SAへ共有された範囲のみ・metadata READ ONLY'
              : 'Service Account未設定'
      },
      asEntry('AnyONE', 'MANUAL_IMPORT', pick('anyone(historical-export)'), '公式APIなし。data/import/anyone/inboxへのCSV/Excel投入経路は実装済み・実データ未投入（0件）'),
      asEntry('TKC', 'MANUAL_IMPORT', pick('tkc'), '公式APIなし。data/import/tkc inbox経路は実装済み・実データ未投入（0件）'),
      // DIOS リアルタイム（実着信確認までLIVE_APIと表示しない）
      ...(await (async () => {
        const { resolveGmailAuthState } = await import('../integrations/gmail/gmailClient.js');
        const { loadGmailState } = await import('../integrations/gmail/gmailSync.js');
        const { defaultIntelligenceDir } = await import('../intelligence/store.js');
        const { readFileSync: rf, existsSync: ex } = await import('node:fs');
        const { join: pj } = await import('node:path');
        const ga = resolveGmailAuthState();
        const gs = loadGmailState();
        const subFile = pj(defaultIntelligenceDir(), 'subscriber-state.json');
        const sub = ex(subFile) ? (JSON.parse(rf(subFile, 'utf8')) as { gmail?: { lastPullAt?: string | null; lastOutcome?: string }; lineworks?: { lastPullAt?: string | null; lastOutcome?: string; lastEventAt?: string | null; processed?: number } }) : null;
        const gmailRealtimeClass = ga.state !== 'READY' ? 'CONFIG_REQUIRED' : gs.lastSuccessfulFetchAt ? 'CONFIGURED_AWAITING_LIVE_TEST' : 'CONFIGURED_NOT_VERIFIED';
        return [
          {
            system: 'Gmail（リアルタイム・Pub/Sub Pull）',
            classification: gmailRealtimeClass,
            records: gs.processedCount,
            lastSyncedAt: gs.lastSuccessfulFetchAt,
            errors: [],
            note: [
              ga.state !== 'READY' ? (ga.state === 'CONFIG_REQUIRED' ? ga.reason : '初回OAuth認証待ち（npm run gmail:authorize）') : null,
              gs.watchExpiration ? `watch期限 ${gs.watchExpiration.slice(0, 16)}` : 'watch未登録',
              gs.lastEventAt ? `最終通知 ${gs.lastEventAt.slice(0, 16)}` : '通知未受信',
              gs.lastMeasuredLagMs !== null ? `実測遅延 ${Math.round(gs.lastMeasuredLagMs / 1000)}秒` : null,
              sub?.gmail?.lastPullAt ? `subscriber最終pull ${sub.gmail.lastPullAt.slice(0, 16)}` : 'subscriber未稼働',
              '実着信確認までLIVE_APIとしない'
            ].filter(Boolean).join('／')
          },
          {
            system: 'LINE WORKS（リアルタイム・Cloud Run relay）',
            classification: sub?.lineworks?.lastEventAt ? 'CONFIGURED_AWAITING_LIVE_TEST' : 'CONFIG_REQUIRED',
            records: sub?.lineworks?.processed ?? 0,
            lastSyncedAt: sub?.lineworks?.lastEventAt ?? null,
            errors: [],
            note: [
              'relay実装済み（cloudrun/lcc-lineworks-relay・deployは承認待ち）',
              sub?.lineworks?.lastPullAt ? `subscriber最終pull ${sub.lineworks.lastPullAt.slice(0, 16)}` : 'subscriber未稼働',
              '実着信確認までLIVE_APIとしない'
            ].filter(Boolean).join('／')
          }
        ];
      })())
    ];
    return c.json({
      generatedAt: new Date().toISOString(),
      statusUpdatedAt: raw.updatedAt ?? null,
      vocabulary: 'LIVE_API=今回実取得成功のみ / SHEET_INGESTED=シート経由取込（本体API接続ではない） / MANUAL_IMPORT=手動投入経路のみ / NOT_CONNECTED / ERROR',
      connections,
      writePolicy: '外部システムへの書き込みはデフォルト無効（GET+OAuth token交換POSTのみ）'
    });
  });

  // 端末ペアリング開始（PC側・認証済みのみ）。6桁コードを返す（ログへ出さない・tokenは保存しない）
  app.post('/pair/start', (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}は端末認証コードを発行できません` }, 403);
    }
    const issued = pairing.startPairing(principal);
    return c.json({ code: issued.code, expiresInSec: issued.expiresInSec, note: 'コードは5分有効・1回限りです', pairUrls: lanPairUrls() });
  });

  // ?token=→HttpOnlyセッションへの交換（PC側もtokenをlocalStorageへ永続保存しない）
  app.post('/pair/exchange', (c) => {
    const principal = c.get('principal');
    const sid = pairing.issueSession(principal, c.req.header('user-agent') ?? '');
    c.header('set-cookie', `lcc_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    return c.json({ ok: true });
  });

  // 現在端末のログアウト
  app.post('/pair/logout', (c) => {
    pairing.revoke(readSid(c));
    c.header('set-cookie', 'lcc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return c.json({ ok: true, message: 'この端末の認証を解除しました' });
  });

  // 全端末失効（PRESIDENTのみ）
  app.post('/pair/revoke-all', (c) => {
    const principal = c.get('principal');
    if (principal.role !== 'PRESIDENT') {
      return c.json({ error: '全端末失効はPRESIDENTのみ実行できます' }, 403);
    }
    const n = pairing.revokeAll();
    c.header('set-cookie', 'lcc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return c.json({ ok: true, revoked: n });
  });

  // EXECUTIVE UI: ホームの「今日の意思決定」実データ（決定論actionItemsの上位。捏造なし）
  // DIOS-4: 追跡件数（AIが追跡中/今日完了）を同梱し、ホームは判断1件原則で表示できるようにする
  app.get('/today/decisions', async (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}は意思決定一覧を参照できません` }, 403);
    }
    const { actionItems } = await import('../integrations/knowledge/vaultInsights.js');
    const result = actionItems();
    let tracking = { trackingCount: 0, completedTodayCount: 0, waitingPresidentCount: 0 };
    try {
      const { IntelligenceStore } = await import('../intelligence/store.js');
      const actions = new IntelligenceStore().actions();
      const today = new Date().toISOString().slice(0, 10);
      tracking = {
        trackingCount: actions.filter((a) => !['COMPLETED', 'ARCHIVED'].includes(a.status)).length,
        completedTodayCount: actions.filter((a) => a.status === 'COMPLETED' && (a.completedAt ?? '').startsWith(today)).length,
        waitingPresidentCount: actions.filter((a) => a.status === 'WAITING_PRESIDENT').length
      };
    } catch { /* 追跡層の失敗で判断表示は止めない */ }
    return c.json({ generatedAt: result.generatedAt, items: result.items, dataBasis: result.dataBasis, notes: result.notes, tracking });
  });

  // DIOS-4: 追跡・完了履歴（完了は通常画面から消すが削除せず検索可能に保持）
  app.get('/intelligence/actions', async (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}は追跡一覧を参照できません` }, 403);
    }
    const { IntelligenceStore } = await import('../intelligence/store.js');
    const q = (c.req.query('q') ?? '').trim();
    const view = c.req.query('view') === 'completed' ? 'completed' : 'active';
    const all = new IntelligenceStore().actions();
    const filtered = all
      .filter((a) => (view === 'completed' ? a.status === 'COMPLETED' || a.status === 'ARCHIVED' : !['COMPLETED', 'ARCHIVED'].includes(a.status)))
      .filter((a) => !q || a.title.includes(q) || a.entities.some((e) => e.name.includes(q)))
      .sort((a, b) => (b.createdAt).localeCompare(a.createdAt))
      .slice(0, 100);
    return c.json({ view, count: filtered.length, actions: filtered });
  });

  app.post('/intelligence/actions/:id/complete', async (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}は完了操作ができません` }, 403);
    }
    const { IntelligenceStore } = await import('../intelligence/store.js');
    const updated = new IntelligenceStore().updateActionStatus(c.req.param('id'), 'COMPLETED');
    if (!updated) return c.json({ error: '対象が見つかりません' }, 404);
    return c.json({ ok: true, action: updated });
  });

  // REAL USE 75%: Drive検索（LIVE_API化後に利用可能。未接続時は正直にERRORを返す）
  app.get('/drive/search', async (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}はDrive検索を利用できません` }, 403);
    }
    const q = c.req.query('q')?.trim();
    if (!q || q.length < 2) return c.json({ error: 'クエリq（2文字以上）を指定してください' }, 400);
    const { DriveClient } = await import('../integrations/drive/driveClient.js');
    const client = DriveClient.fromEnv();
    if (!client) return c.json({ state: 'NOT_CONNECTED', reason: 'Service Account未設定' }, 503);
    try {
      const hits = await client.searchByName(q, Math.min(Number(c.req.query('limit') ?? 20) || 20, 50));
      return c.json({ state: 'LIVE_API', query: q, hits });
    } catch (error) {
      const check = await client.checkConnection();
      return c.json(
        { state: 'ERROR', reason: check.state === 'ERROR' ? check.reason : String(error), fix: check.state === 'ERROR' ? check.fix : undefined },
        503
      );
    }
  });

  app.get('/providers', async (c) => {
    const principal = c.get('principal');
    if (!canDecideApproval(principal)) {
      return c.json({ error: `ロール${principal.role}はProvider設定を参照できません` }, 403);
    }
    // 是正⑦: 外部LLM Providerは実API疎通の結果でACTIVE/AUTH_FAILED等を表示する
    // （キーの値・先頭・末尾は応答へ含めない。httpStatusとチェック時刻のみ）
    const views = await Promise.all(
      providerRegistry.describe().map(async (view) => {
        if (
          view.status === 'CONFIGURED_UNVERIFIED' &&
          ['anthropic', 'openai', 'gemini'].includes(view.providerId)
        ) {
          const probe = await providerVerification.getStatus(view.providerId);
          return {
            ...view,
            status: probe.status,
            verification: {
              httpStatus: probe.httpStatus ?? null,
              checkedAt: probe.checkedAt,
              retryable: probe.retryable
            }
          };
        }
        return view;
      })
    );
    return c.json({ providers: views });
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

  // --- Phase X: Constitution / Future / Capability / Artifact / Stewardship / Search ---

  app.get('/constitution', async (c) => {
    try {
      return c.json({ principles: await constitutionService.list() });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // 会社原則の正式確定（PRESIDENTのみ。§5: AI判断だけでCURRENTにしない）
  app.post('/constitution/:id/approve', async (c) => {
    const principal = c.get('principal');
    try {
      const approved = await constitutionService.approve(c.req.param('id'), principal, nowIso());
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'constitution_approve',
        scope: approved.scope,
        detail: approved.principleId,
        outcome: 'ok'
      });
      return c.json(approved);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/future', async (c) => {
    try {
      const { scope, dataset } = await scopedDataset(c);
      return c.json({ insights: computeFutureInsights(dataset, scope) });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // AI Capability Registry（§15。データCapability Matrixとは別物）
  app.get('/ai-capabilities', async (c) => {
    const available = availableProvidersFromEnv();
    // 是正⑦: LLM Providerはキー存在ではなく実疎通ACTIVEのみ「利用可能」に数える。
    // キーはあるが疎通未成功のProviderしか無いCapabilityは、その検証状態を表示する。
    const llmIds = ['anthropic', 'openai', 'gemini'] as const;
    const verifiedStatuses = new Map<string, VerifiedProviderStatus>();
    for (const id of llmIds) {
      if (available.has(id)) {
        verifiedStatuses.set(id, (await providerVerification.getStatus(id)).status);
      }
    }
    const effectiveAvailable = new Set(
      [...available].filter(
        (id) =>
          !llmIds.includes(id as (typeof llmIds)[number]) || verifiedStatuses.get(id) === 'ACTIVE'
      )
    );
    return c.json({
      capabilities: CAPABILITIES.map((definition) => {
        let status: string = capabilityStatus(definition, effectiveAvailable);
        if (status === 'NOT_CONFIGURED') {
          const keyedStatuses = definition.providers
            .map((p) => verifiedStatuses.get(p))
            .filter((s): s is VerifiedProviderStatus => s !== undefined);
          if (keyedStatuses.length > 0) {
            status =
              keyedStatuses.find((s) => s === 'AUTH_FAILED') ??
              keyedStatuses.find((s) => s === 'RATE_LIMITED') ??
              keyedStatuses.find((s) => s === 'TEMPORARILY_UNAVAILABLE') ??
              'CONFIGURED_UNVERIFIED';
          }
        }
        return { ...definition, status };
      })
    });
  });

  app.get('/artifacts', async (c) => {
    try {
      return c.json({ artifacts: await artifactService.list() });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/stewardship', (c) => c.json({ stewards: DATA_STEWARDSHIP }));

  // Outcome Learning（LIVE-AI §31）: 成果物の効果を記録しLESSON化（自動学習には使わない）
  app.post('/artifacts/:id/outcome', async (c) => {
    const principal = c.get('principal');
    try {
      const body = (await c.req.json()) as { outcome?: string };
      if (!body.outcome || typeof body.outcome !== 'string') {
        throw new ValidationError('outcome（結果の説明）を指定してください');
      }
      const updated = await artifactService.recordOutcome(
        c.req.param('id'),
        body.outcome.slice(0, 200),
        nowIso()
      );
      if (!updated) return c.json({ error: 'artifact not found' }, 404);
      try {
        await memoryService.save(
          {
            type: 'LESSON',
            statement: `成果物「${updated.title.slice(0, 40)}」の結果: ${body.outcome.slice(0, 120)}`,
            entities: [],
            relations: [],
            layer: 'OPERATIONAL',
            sensitivity: 'NORMAL',
            companyId: 'lcc',
            source: 'CONVERSATION',
            sourceId: updated.artifactId,
            sourceTimestamp: nowIso(),
            validFrom: nowIso().slice(0, 10),
            confidence: 'MEDIUM',
            createdBy: `user:${principal.label}`,
            reviewStatus: 'AUTO',
            evidence: [
              { label: 'Artifact', value: updated.artifactId, source: 'Artifact Registry', asOf: nowIso() }
            ]
          },
          nowIso()
        );
      } catch {
        // Lesson保存失敗でもOutcome記録自体は成立
      }
      return c.json(updated);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/search', async (c) => {
    const principal = c.get('principal');
    try {
      const q = (c.req.query('q') ?? '').slice(0, 100);
      if (!q) throw new ValidationError('q（検索語）を指定してください');
      const { dataset } = await scopedDataset(c);
      const memories = await new MemorySearchService(repository).search({ limit: 100 }, principal);
      return c.json({ results: unifiedSearch(dataset, memories, q, principal) });
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

  // --- Phase GROWTH: Growth Backlog / Self-Evaluation / Review / Promotion ---

  app.get('/growth/backlog', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はGrowth Backlogを参照できません`);
      }
      return c.json({
        items: await growthService.list(),
        topProposals: await growthService.topProposals(2)
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/growth/self-evaluation', (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はAI自己評価を参照できません`);
      }
      return c.json({ evaluation: orchestrator.getSelfEvaluation() });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/growth/review', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はGrowth Reviewを参照できません`);
      }
      const period = c.req.query('period') ?? 'daily';
      if (period !== 'daily' && period !== 'weekly' && period !== 'monthly') {
        throw new ValidationError('period は daily / weekly / monthly のいずれかです');
      }
      const items = await growthService.list();
      const memories = await repository.getMemories();
      const input: GrowthReviewInput = {
        // 変化検知（signals/patterns）は日次観測スクリプトのスナップショット履歴が正本
        signals: [],
        patterns: [],
        backlog: await growthService.backlog(),
        repairs: items.filter((i) => i.kind === 'REPAIR'),
        experiments: await repository.getExperiments(),
        lessons: memories.filter((m) => m.type === 'LESSON' && m.status === 'ACTIVE'),
        selfEvaluation: orchestrator.getSelfEvaluation(),
        incidents: await incidentService.summarize()
      };
      const text =
        period === 'weekly'
          ? buildWeeklyGrowthReview(input)
          : period === 'monthly'
            ? buildMonthlyIntelligenceReview(input)
            : buildDailyGrowthReview(input);
      return c.json({
        period,
        text,
        note: '前回比の変化検知は日次観測（npm run command:growth）のスナップショット履歴に基づきます'
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Data Repair Candidateの人間確認（§19。AIはSource of Truthを直接修正しない）
  app.post('/growth/repairs/:id/confirm', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}は修正候補を確定できません`);
      }
      const repair = await growthService.confirmRepair(c.req.param('id'), principal, nowIso());
      if (!repair) return c.json({ error: '対象の修正候補が見つかりません' }, 404);
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'growth_repair_confirm',
        scope: 'group',
        detail: repair.repairId,
        outcome: 'ok'
      });
      return c.json({ repair });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Promotion Pipeline（§27-§28）。ACTIVE化は人間承認必須・Safety Gate対象は不可（§46）
  app.post('/growth/improvements/:id/advance', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}は改善候補を昇格できません`);
      }
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const improvement = await promotionPipeline.advance(c.req.param('id'), nowIso(), {
        approvedBy: body.approve === true ? principal.label : undefined,
        evaluation: typeof body.evaluation === 'string' ? body.evaluation : undefined
      });
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'growth_improvement_advance',
        scope: 'group',
        detail: `${improvement.improvementId} → ${improvement.status}`,
        outcome: 'ok'
      });
      return c.json({ improvement });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // --- LIVE BETA: Beta Gate / Incident Log / Autonomy Review / Constitution Review ---

  app.get('/beta-gate', (c) => {
    // §20の全条件を決定論判定（未接続Gap＝銀行・会計・日報紐付けはGate条件に含めない §1）
    const gate = evaluateBetaGate({
      growthBaselineStarted: existsSync('data/growth-snapshots.jsonl')
    });
    return c.json(gate);
  });

  app.get('/incidents', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はIncident Logを参照できません`);
      }
      return c.json({
        incidents: await incidentService.list(),
        summary: await incidentService.summarize()
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/incidents', async (c) => {
    const principal = c.get('principal');
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const kinds: IncidentKind[] = [
        'WRONG_ANSWER',
        'WRONG_SEARCH',
        'WRONG_MEMORY',
        'WRONG_ROUTING',
        'UI',
        'LATENCY',
        'PROVIDER_OUTAGE'
      ];
      if (!kinds.includes(body.kind as IncidentKind)) {
        throw new ValidationError(`kind は ${kinds.join(' / ')} のいずれかです`);
      }
      if (typeof body.description !== 'string' || body.description.trim().length === 0) {
        throw new ValidationError('description は必須です（会話本文・機微情報は書かない）');
      }
      const severity = body.severity === 'HIGH' || body.severity === 'MEDIUM' ? body.severity : 'LOW';
      const result = await incidentService.report(
        {
          kind: body.kind as IncidentKind,
          description: body.description,
          severity,
          sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : undefined
        },
        principal,
        nowIso()
      );
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'incident_report',
        scope: 'group',
        detail: `${result.incident.incidentId} ${result.incident.kind}`,
        outcome: 'ok'
      });
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/incidents/:id/transition', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はIncidentの状態を変更できません`);
      }
      const body = (await c.req.json()) as Record<string, unknown>;
      const statuses: IncidentStatus[] = ['OPEN', 'ANALYZED', 'RESOLVED'];
      if (!statuses.includes(body.status as IncidentStatus)) {
        throw new ValidationError('status は OPEN / ANALYZED / RESOLVED のいずれかです');
      }
      const incident = await incidentService.transition(
        c.req.param('id'),
        body.status as IncidentStatus,
        nowIso(),
        typeof body.resolutionNote === 'string' ? body.resolutionNote : undefined
      );
      if (!incident) return c.json({ error: '対象のIncidentが見つかりません' }, 404);
      return c.json({ incident });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Autonomy Review（§11）。LEVEL昇格は提案まで（勝手に昇格しない）
  app.get('/growth/autonomy-review', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はAutonomy Reviewを参照できません`);
      }
      const review = computeAutonomyReview(
        observability.recent(2000),
        await incidentService.list(),
        await growthService.backlog()
      );
      return c.json({ review });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // President Decision Load（§18・追跡候補KPI）
  app.get('/growth/decision-load', async (c) => {
    const principal = c.get('principal');
    try {
      if (!canDecideApproval(principal)) {
        throw new AccessDeniedError(`ロール${principal.role}はDecision Loadを参照できません`);
      }
      const store = await repository.getStore();
      return c.json({ decisionLoad: computePresidentDecisionLoad(store, observability.recent(2000)) });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Constitution最終確定支援（§6-§7）
  app.get('/constitution/review-summary', async (c) => {
    try {
      return c.json(await buildReviewSummary(constitutionService));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/constitution/approve-bulk', async (c) => {
    const principal = c.get('principal');
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      // §7: 「この内容で確定」の明示のみ正式化する
      if (body.confirm !== 'この内容で確定') {
        throw new ValidationError('一括承認には confirm: "この内容で確定" の明示が必要です');
      }
      const result = await bulkApprove(constitutionService, principal, nowIso(), {
        includeIndividualConfirm: body.includeIndividualConfirm === true
      });
      await audit.record({
        actor: principal.label,
        role: principal.role,
        action: 'constitution_approve_bulk',
        scope: 'group',
        detail: `approved=${result.approvedPrincipleIds.length} skipped=${result.skippedForIndividualConfirm.length}`,
        outcome: 'ok'
      });
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
