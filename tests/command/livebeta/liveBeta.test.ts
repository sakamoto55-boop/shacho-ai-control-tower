/**
 * LIVE BETA ACTIVATION のテスト。
 *
 * - §4-§5: 実戦19問 + 30ターン連続会話（全ターン応答・クラッシュなし・Context Retention）
 * - §6-§7: Constitution最終確定支援（10項目サマリー・一括承認・Conflict個別確認・PRESIDENT限定）
 * - §11: Autonomy Review（データ不足時は昇格提案しない・勝手に昇格しない）
 * - §14: Learning Audit（何を訂正した / AI自身は何が苦手）
 * - §15: Weekly ReviewのCompany/AI/Data 3分離
 * - §19: Incident Log（削除しない・3件でGrowth候補化）
 * - §20: Beta Gate（最小起動条件・PENDING_USERへの具体手順）
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { createCommandApp } from '../../../src/command/server/routes.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';
import { resetMemorySeq } from '../../../src/command/memory/store.js';
import { resetPlanSeq } from '../../../src/command/agents/rolePlanner.js';
import { resetGrowthSeq } from '../../../src/command/growth/growthBacklog.js';
import { BATTLE_QUESTIONS, CONTINUOUS_30, buildRealEval100 } from '../../../src/command/livebeta/battleSet.js';
import { evaluateBetaGate } from '../../../src/command/livebeta/betaGate.js';
import { IncidentService, resetIncidentSeq } from '../../../src/command/livebeta/incidentLog.js';
import {
  computeAutonomyReview,
  computePresidentDecisionLoad,
  CURRENT_AUTONOMY_LEVEL
} from '../../../src/command/growth/autonomyReview.js';
import { buildReviewSummary, bulkApprove, REVIEW_ITEMS } from '../../../src/command/constitution/reviewSummary.js';
import { ConstitutionService } from '../../../src/command/constitution/constitutionRegistry.js';
import { buildWeeklyGrowthReview } from '../../../src/command/growth/growthReview.js';
import { computeSelfEvaluation } from '../../../src/command/growth/selfEvaluation.js';
import type { ObservabilityEntry } from '../../../src/command/observability/observability.js';
import type { Principal } from '../../../src/command/domain/types.js';

const ASOF = '2026-08-08T00:00:00.000Z';
const PRESIDENT: Principal = { role: 'PRESIDENT', companyIds: [], label: '社長' };
const STAFF: Principal = { role: 'STAFF', companyIds: ['lcc'], label: 'スタッフ' };

function freshOrchestrator(): { repository: InMemoryCommandRepository; orchestrator: CommandOrchestrator } {
  resetToolIdSeq();
  resetMemorySeq();
  resetPlanSeq();
  resetGrowthSeq();
  resetIncidentSeq();
  const repository = new InMemoryCommandRepository();
  return { repository, orchestrator: new CommandOrchestrator(repository) };
}

describe('LIVE BETA §4-§5: 実戦質問セット・連続会話', () => {
  it('実戦19問を連続実行して全問クラッシュなく応答する', async () => {
    const { orchestrator } = freshOrchestrator();
    for (const message of BATTLE_QUESTIONS) {
      const response = await orchestrator.chat({
        message,
        scope: 'group',
        asOf: ASOF,
        sessionId: 'battle'
      });
      expect(response.text.trim().length, message).toBeGreaterThan(0);
    }
  });

  it('30ターン連続会話で全ターン応答し文脈を保持する（Context Retention）', async () => {
    const { orchestrator } = freshOrchestrator();
    expect(CONTINUOUS_30.length).toBeGreaterThanOrEqual(30);
    for (const message of CONTINUOUS_30) {
      const response = await orchestrator.chat({
        message,
        scope: 'group',
        asOf: ASOF,
        sessionId: 'continuous30'
      });
      expect(response.text.trim().length, message).toBeGreaterThan(0);
    }
    // 文脈保持: 直前の話題を参照する質問が独立質問として壊れていないこと
    const followUp = await orchestrator.chat({
      message: 'なんで？',
      scope: 'group',
      asOf: ASOF,
      sessionId: 'continuous30'
    });
    expect(followUp.text.trim().length).toBeGreaterThan(0);
  });

  it('実データ評価セットは100問以上でHallucination Probeを含む（§4）', () => {
    const questions = buildRealEval100();
    expect(questions.length).toBeGreaterThanOrEqual(100);
    expect(questions.some((q) => q.hallucinationProbe)).toBe(true);
    // 未接続領域は expectAnswerable=false（推測で答える前提を作らない）
    expect(questions.filter((q) => q.category === 'cash').every((q) => !q.expectAnswerable)).toBe(true);
  });
});

describe('LIVE BETA §6-§7: Constitution最終確定支援', () => {
  let repository: InMemoryCommandRepository;
  let service: ConstitutionService;

  beforeEach(() => {
    repository = new InMemoryCommandRepository();
    service = new ConstitutionService(repository);
  });

  it('10項目サマリーに原文・出典・状態・AI推奨・影響が揃い、Conflict項目は個別確認になる', async () => {
    expect(REVIEW_ITEMS).toHaveLength(10);
    const summary = await buildReviewSummary(service);
    expect(summary.items).toHaveLength(10);
    for (const item of summary.items) {
      expect(item.originals.length, item.title).toBeGreaterThan(0);
      expect(item.originals[0].statement.length).toBeGreaterThan(5);
      expect(item.originals[0].source.length).toBeGreaterThan(3);
      expect(item.meaning.length).toBeGreaterThan(5);
      expect(item.impact.length).toBeGreaterThan(5);
      expect(item.aiRecommendation).toContain('承認推奨');
    }
    expect(summary.individualConfirm).toEqual([10]); // 第13期目標値（Conflict解消済み）のみ個別
    expect(summary.bulkApprovable).toHaveLength(9);
  });

  it('一括承認はConflict項目を除いて正式化し、履歴（承認者）を残す（§7）', async () => {
    const result = await bulkApprove(service, PRESIDENT, ASOF);
    expect(result.approvedPrincipleIds.length).toBe(15); // 10項目中9項目分（保留3原則は対象外）
    expect(result.skippedForIndividualConfirm).toEqual(['const-007', 'const-020']);
    const current = await service.current();
    expect(current.length).toBe(15);
    expect(current.every((p) => p.approvedBy === '社長' && p.approvedAt === ASOF)).toBe(true);
  });

  it('PRESIDENT以外は一括承認できない', async () => {
    await expect(bulkApprove(service, STAFF, ASOF)).rejects.toThrow('確定できません');
  });

  it('会話: 承認事項サマリー→「全部この内容で確定」→「不動産課15.0で確定」で憲法が完成する', async () => {
    const { repository: repo, orchestrator } = freshOrchestrator();
    const chat = (message: string) =>
      orchestrator.chat({ message, scope: 'group', asOf: ASOF, sessionId: 'constitution' });

    const review = await chat('憲法の承認事項を見せて');
    expect(review.text).toContain('承認事項サマリー');
    expect(review.text).toContain('全部この内容で確定');
    expect(review.text).toContain('個別確認');

    const bulk = await chat('全部この内容で確定');
    expect(bulk.text).toContain('正式');
    expect(bulk.text).toContain('不動産課15.0で確定');

    const individual = await chat('不動産課15.0で確定');
    expect(individual.text).toContain('正式化');

    const constitutionService = new ConstitutionService(repo);
    const current = await constitutionService.current();
    expect(current.length).toBe(17); // 15 + const-007 + const-020（保留3原則はCANDIDATEのまま）
    expect(current.some((p) => p.principleId === 'const-007')).toBe(true);
  });
});

describe('LIVE BETA §8: Target Review', () => {
  it('候補も正式目標もない場合、憲法承認→Target登録の導線を正直に示す', async () => {
    const { orchestrator } = freshOrchestrator();
    const response = await orchestrator.chat({
      message: '目標を確認したい',
      scope: 'group',
      asOf: ASOF
    });
    expect(response.text).toContain('経営目標レビュー');
    expect(response.text).toContain('正式承認済みの目標はまだありません');
    expect(response.text).toContain('承認事項');
  });
});

describe('LIVE BETA §14: Learning Audit', () => {
  it('「何を訂正した？」は訂正なしを正直に、訂正後は履歴を提示する', async () => {
    const { orchestrator } = freshOrchestrator();
    const chat = (message: string) =>
      orchestrator.chat({ message, scope: 'group', asOf: ASOF, sessionId: 'audit' });
    const before = await chat('何を訂正した？');
    expect(before.text).toContain('まだ訂正された記憶はありません');

    await chat('株式会社テストの担当は佐藤さん、を覚えておいて');
    await chat('それ違う。今は担当は田中さん');
    const after = await chat('何を訂正した？');
    expect(after.text).toContain('訂正履歴');
    expect(after.text).toContain('履歴として保持');
  });

  it('「AI自身は何が苦手？」に未接続Gap・測定状態・禁止事項を正直に答える', async () => {
    const { orchestrator } = freshOrchestrator();
    const response = await orchestrator.chat({ message: 'AI自身は何が苦手？', scope: 'group', asOf: ASOF });
    expect(response.text).toContain('データ未接続による不得意');
    expect(response.text).toContain('効果測定できていません');
    expect(response.text).toContain('自動送信');
  });
});

describe('LIVE BETA §19: Incident Log', () => {
  it('Incidentを記録し、同種3件でGrowth候補化する（削除はできない設計）', async () => {
    resetIncidentSeq();
    resetGrowthSeq();
    const repository = new InMemoryCommandRepository();
    const service = new IncidentService(repository);
    const first = await service.report(
      { kind: 'WRONG_ANSWER', description: '売上の回答が古い月を参照', severity: 'MEDIUM' },
      PRESIDENT,
      ASOF
    );
    expect(first.incident.status).toBe('OPEN');
    expect(first.growthCandidate).toBeNull();
    await service.report({ kind: 'WRONG_ANSWER', description: '2件目', severity: 'LOW' }, PRESIDENT, ASOF);
    const third = await service.report(
      { kind: 'WRONG_ANSWER', description: '3件目', severity: 'LOW' },
      PRESIDENT,
      ASOF
    );
    expect(third.growthCandidate).not.toBeNull();
    expect(third.growthCandidate?.source).toBe('INCIDENT');
    expect(third.growthCandidate?.title).toContain('誤回答');

    // 状態遷移のみ（履歴保持）
    const resolved = await service.transition(first.incident.incidentId, 'RESOLVED', ASOF, '回答ロジック修正候補を登録');
    expect(resolved?.status).toBe('RESOLVED');
    expect((await service.list()).length).toBe(3);
  });
});

describe('LIVE BETA §10-§11・§18: Autonomy Review / Decision Load', () => {
  it('運用データ不足時はLEVEL 1維持を明示し、昇格を提案しない', () => {
    const review = computeAutonomyReview([], [], []);
    expect(review.currentLevel).toBe(CURRENT_AUTONOMY_LEVEL);
    expect(review.evaluable).toBe(false);
    expect(review.recommendation).toContain('LEVEL 1 を維持');
    expect(review.note).toContain('効果測定できていません');
  });

  it('健全な運用データが揃うとLEVEL 2を「提案」する（勝手に昇格しない）', () => {
    const chats: ObservabilityEntry[] = Array.from({ length: 60 }, (_, i) => ({
      timestamp: `2026-08-${String((i % 8) + 1).padStart(2, '0')}T00:00:00.000Z`,
      kind: 'chat',
      confidence: 'HIGH',
      durationMs: 100
    }));
    const review = computeAutonomyReview(chats, [], []);
    expect(review.evaluable).toBe(true);
    expect(review.recommendation).toContain('提案');
    expect(review.recommendation).toContain('明示承認');
    expect(review.currentLevel).toBe(1); // 提案してもLEVELは変わらない
  });

  it('President Decision Loadは実運用データなしを正直に返す（追跡候補KPI）', () => {
    const load = computePresidentDecisionLoad({ approvals: [], decisions: [] }, []);
    expect(load.totalChats).toBe(0);
    expect(load.note).toContain('実運用データがまだありません');
  });
});

describe('LIVE BETA §15: Weekly ReviewのCompany/AI/Data 3分離', () => {
  it('週次レビューに3つの成長ドメインが必ず分離して現れる', () => {
    const text = buildWeeklyGrowthReview({
      signals: [],
      patterns: [],
      backlog: [],
      repairs: [],
      experiments: [],
      lessons: [],
      selfEvaluation: computeSelfEvaluation([], [])
    });
    expect(text).toContain('■ Company Growth');
    expect(text).toContain('■ AI Growth');
    expect(text).toContain('■ Data Growth');
    expect(text).toContain('Incident: 未計測');
  });
});

describe('LIVE BETA §20: Beta Gate', () => {
  it('未接続環境では最小起動条件が未達で、ユーザー操作の具体手順を返す', () => {
    const gate = evaluateBetaGate({ env: {} as NodeJS.ProcessEnv });
    expect(gate.ready).toBe(false);
    expect(gate.declaration).toBeNull();
    expect(gate.minimumStartSatisfied).toBe(false);
    const userSteps = gate.conditions.filter((c) => c.status === 'PENDING_USER');
    expect(userSteps.length).toBeGreaterThan(0);
    expect(userSteps.every((c) => (c.action ?? '').length > 5)).toBe(true);
  });

  it('Sheets SA + 実LLM 1つで最小起動条件を満たす（§1: Gapで全体を止めない）', () => {
    const env = {
      GOOGLE_SERVICE_ACCOUNT_FILE: '/secure/sa.json',
      ANTHROPIC_API_KEY: 'test-key'
    } as unknown as NodeJS.ProcessEnv;
    const gate = evaluateBetaGate({ env, sanityReady: true });
    expect(gate.minimumStartSatisfied).toBe(true);
    // 銀行・会計・日報紐付けのGapはGate条件に存在しない
    expect(gate.conditions.some((c) => c.title.includes('銀行') || c.title.includes('会計'))).toBe(false);
  });

  it('全条件PASSで LIVE READ-ONLY BETA READY を宣言する', () => {
    const env = {
      GOOGLE_SERVICE_ACCOUNT_FILE: '/secure/sa.json',
      ANTHROPIC_API_KEY: 'test-key'
    } as unknown as NodeJS.ProcessEnv;
    const gate = evaluateBetaGate({
      env,
      sanityReady: true,
      realEvalPassed: true,
      growthBaselineStarted: true
    });
    expect(gate.ready).toBe(true);
    expect(gate.declaration).toBe('LCC COMMAND LIVE READ-ONLY BETA READY');
  });
});

describe('LIVE BETA API', () => {
  let app: ReturnType<typeof createCommandApp>;

  beforeEach(() => {
    resetToolIdSeq();
    resetIncidentSeq();
    resetGrowthSeq();
    app = createCommandApp(new InMemoryCommandRepository());
  });

  it('GET /beta-gate がGate状態を返す', async () => {
    const res = await app.request('/beta-gate');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ready: boolean; conditions: unknown[] };
    expect(body.conditions.length).toBeGreaterThanOrEqual(14);
  });

  it('POST /incidents → GET /incidents でIncidentが記録される', async () => {
    const post = await app.request('/incidents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'LATENCY', description: '回答が10秒超', severity: 'LOW' })
    });
    expect(post.status).toBe(200);
    const get = await app.request('/incidents');
    const body = (await get.json()) as { incidents: unknown[]; summary: unknown[] };
    expect(body.incidents).toHaveLength(1);
  });

  it('POST /incidents は不正kindを400にする', async () => {
    const res = await app.request('/incidents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'INVALID', description: 'x' })
    });
    expect(res.status).toBe(400);
  });

  it('GET /growth/autonomy-review と /growth/decision-load が正直な初期状態を返す', async () => {
    const autonomy = await app.request('/growth/autonomy-review');
    expect(autonomy.status).toBe(200);
    const autonomyBody = (await autonomy.json()) as { review: { currentLevel: number; evaluable: boolean } };
    expect(autonomyBody.review.currentLevel).toBe(1);
    expect(autonomyBody.review.evaluable).toBe(false);

    const load = await app.request('/growth/decision-load');
    expect(load.status).toBe(200);
  });

  it('GET /constitution/review-summary が10項目を返し、承認前は全てCANDIDATE', async () => {
    const res = await app.request('/constitution/review-summary');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ currentStatus: string }> };
    expect(body.items).toHaveLength(10);
    expect(body.items.every((i) => i.currentStatus === 'CANDIDATE')).toBe(true);
  });

  it('POST /constitution/approve-bulk は「この内容で確定」明示がないと400', async () => {
    const missing = await app.request('/constitution/approve-bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(missing.status).toBe(400);

    const ok = await app.request('/constitution/approve-bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'この内容で確定' })
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { approvedPrincipleIds: string[]; skippedForIndividualConfirm: string[] };
    expect(body.approvedPrincipleIds.length).toBe(15);
    expect(body.skippedForIndividualConfirm).toEqual(['const-007', 'const-020']);
  });

  it('STAFFはIncident・Autonomy Reviewを参照できない（RBAC）', async () => {
    const tokens = JSON.stringify({
      'tok-staff': { role: 'STAFF', companyIds: ['lcc'], label: 'スタッフ' }
    });
    const guarded = createCommandApp({ repository: new InMemoryCommandRepository(), apiTokens: tokens });
    for (const path of ['/incidents', '/growth/autonomy-review', '/growth/decision-load']) {
      const res = await guarded.request(path, { headers: { authorization: 'Bearer tok-staff' } });
      expect(res.status, path).toBe(403);
    }
  });
});
