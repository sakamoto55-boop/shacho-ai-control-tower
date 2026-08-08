import { beforeEach, describe, expect, it } from 'vitest';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { createCommandApp } from '../../../src/command/server/routes.js';
import {
  CONSTITUTION_CANDIDATES,
  ConstitutionService,
  resetPrincipleSeq
} from '../../../src/command/constitution/constitutionRegistry.js';
import {
  computeFutureInsights,
  parseScenario,
  runScenario
} from '../../../src/command/future/futureEngine.js';
import {
  CAPABILITIES,
  availableProvidersFromEnv,
  capabilityStatus,
  routeCapabilities
} from '../../../src/command/capabilities/capabilityRegistry.js';
import {
  ArtifactService,
  planArtifactCreation,
  resetArtifactSeq
} from '../../../src/command/artifacts/artifactRegistry.js';
import { checkDuplicates, buildSoftwarePlan } from '../../../src/command/build/softwareBuild.js';
import { unifiedSearch } from '../../../src/command/search/unifiedSearch.js';
import { draftEstimate } from '../../../src/command/estimate/estimateCapability.js';
import { DATA_STEWARDSHIP, findSteward } from '../../../src/command/domain/stewardship.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';
import { resetMemorySeq } from '../../../src/command/memory/store.js';
import { resetPlanSeq } from '../../../src/command/agents/rolePlanner.js';

const ASOF = '2026-08-08T00:00:00.000Z';
const PRESIDENT = { role: 'PRESIDENT' as const, companyIds: [], label: '社長' };
const STAFF = { role: 'STAFF' as const, companyIds: ['lcc'], label: '担当' };

describe('X: Company Constitution Layer', () => {
  let repository: InMemoryCommandRepository;

  beforeEach(() => {
    resetToolIdSeq();
    resetMemorySeq();
    resetPlanSeq();
    resetPrincipleSeq();
    resetArtifactSeq();
    repository = new InMemoryCommandRepository();
  });

  it('抽出原則はすべてCANDIDATE（AIが勝手にCURRENTにしない）で出典Evidence付き', async () => {
    expect(CONSTITUTION_CANDIDATES.length).toBeGreaterThanOrEqual(8);
    for (const principle of CONSTITUTION_CANDIDATES) {
      expect(principle.status).toBe('CANDIDATE');
      expect(principle.evidence.length).toBeGreaterThan(0);
      expect(principle.source.length).toBeGreaterThan(5);
    }
    // 正本は1つ・粗利信号・武蔵野式が抽出されている
    const statements = CONSTITUTION_CANDIDATES.map((p) => p.statement).join('\n');
    expect(statements).toContain('正本は1つ');
    expect(statements).toContain('武蔵野式');
    expect(statements).toContain('20%未満');
  });

  it('承認はPRESIDENTのみ。方針変更は旧SUPERSEDED+新CANDIDATEで履歴を残す（§8）', async () => {
    const service = new ConstitutionService(repository);
    await expect(service.approve('const-001', STAFF, ASOF)).rejects.toThrow('確定できません');
    const approved = await service.approve('const-001', PRESIDENT, ASOF);
    expect(approved.status).toBe('CURRENT');

    const replaced = await service.supersede('const-001', '正本は1つ。ただしAI Readモデルは例外とする', PRESIDENT, ASOF);
    expect(replaced.status).toBe('CANDIDATE');
    expect(replaced.supersedes).toBe('const-001');
    const all = await service.list();
    expect(all.find((p) => p.principleId === 'const-001')?.status).toBe('SUPERSEDED');
  });

  it('原則に反する提案へ警告する（§7・§46: 新しい入力台帳→正本は1つ）', async () => {
    const service = new ConstitutionService(repository);
    const hits = await service.checkProposal('現場ごとの新しい入力台帳を作成して転記運用にしたい');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].warning).toContain('技術的には可能ですが');
    expect(hits[0].warning).toContain('正本は1つ');
  });

  it('会話「会社の原則」で候補一覧が返る（§47）', async () => {
    const orchestrator = new CommandOrchestrator(repository);
    const res = await orchestrator.chat({ message: '会社の原則を見せて', scope: 'lcc', asOf: ASOF });
    expect(res.text).toContain('Company Constitution');
    expect(res.text).toContain('CANDIDATE');
    expect(res.toolsUsed).toContain('constitution_registry');
  });
});

describe('X: Future Intelligence Engine / Scenario', () => {
  let repository: InMemoryCommandRepository;

  beforeEach(() => {
    resetToolIdSeq();
    resetMemorySeq();
    resetPlanSeq();
    repository = new InMemoryCommandRepository();
  });

  it('決定論のFuture Insightを返し、未接続領域は推測せずUNKNOWNで明示する（§11）', async () => {
    const dataset = await repository.getDataset(ASOF);
    const noBank = { ...dataset, cashAccounts: [], dailyReports: [] };
    const insights = computeFutureInsights(noBank, 'lcc');
    const cashRisk = insights.find((i) => i.kind === 'CASH_RISK');
    expect(cashRisk?.confidence).toBe('UNKNOWN');
    expect(cashRisk?.statement).toContain('INCOMPLETE');
    expect(cashRisk?.relatedGaps).toContain('DG-004');
    const capacity = insights.find((i) => i.kind === 'CAPACITY_RISK');
    expect(capacity?.confidence).toBe('UNKNOWN');
  });

  it('シナリオ: 売上10%減は決定論計算+仮定明示（§13）', async () => {
    const dataset = await repository.getDataset(ASOF);
    const scenario = parseScenario('売上10%落ちたらどうなる？');
    expect(scenario?.salesDeltaPct).toBe(-10);
    const result = runScenario(dataset, 'lcc', scenario!);
    expect(result.lines.join('')).toContain('-10%');
    expect(result.assumptions.length).toBeGreaterThan(0);
    expect(result.assumptions.join('')).toContain('仮定');
  });

  it('シナリオ: 3人辞めたら→人工未接続のため影響額を推測しない', async () => {
    const dataset = await repository.getDataset(ASOF);
    const scenario = parseScenario('3人辞めたらどうなる？');
    expect(scenario?.headcountDelta).toBe(-3);
    const result = runScenario(dataset, 'lcc', scenario!);
    expect(result.lines.join('')).toContain('確定計算できません');
  });

  it('会話「3か月後どうなる？」がFuture Engineへ、「売上10%落ちたら？」がScenarioへ届く', async () => {
    const orchestrator = new CommandOrchestrator(repository);
    const future = await orchestrator.chat({ message: '3か月後どうなる？', scope: 'lcc', asOf: ASOF });
    expect(future.text).toContain('Future Intelligence');
    expect(future.toolsUsed).toContain('future_engine');
    const scenario = await orchestrator.chat({ message: '売上10%落ちたら？', scope: 'lcc', asOf: ASOF });
    expect(scenario.text).toContain('シナリオ分析');
    expect(scenario.text).toContain('明示した仮定');
  });
});

describe('X: Universal Capability Registry / Router / Permission / Cost', () => {
  it('全Capabilityが定義され、Provider未接続はNOT_CONFIGUREDの正常状態（§50）', () => {
    expect(CAPABILITIES.length).toBeGreaterThanOrEqual(40);
    const available = availableProvidersFromEnv({});
    const statuses = CAPABILITIES.map((c) => ({ id: c.capabilityId, status: capabilityStatus(c, available) }));
    // 決定論実装は常時ACTIVE
    expect(statuses.find((s) => s.id === 'SEARCH_INTERNAL')?.status).toBe('ACTIVE');
    expect(statuses.find((s) => s.id === 'CREATE_ESTIMATE_DRAFT')?.status).toBe('ACTIVE');
    // 生成系は未接続
    expect(statuses.find((s) => s.id === 'IMAGE_GENERATION')?.status).toBe('NOT_CONFIGURED');
    expect(statuses.find((s) => s.id === 'PRESENTATION_CREATION')?.status).toBe('NOT_CONFIGURED');
    expect(statuses.find((s) => s.id === 'SOFTWARE_ENGINEERING')?.status).toBe('NOT_CONFIGURED');
  });

  it('Capability Router: ポスター→IMAGE系/プレゼン→作成連鎖/アプリ→BUILD Budget（§18・§39）', () => {
    const poster = routeCapabilities('このイベントのポスター作って');
    expect(poster.capabilities).toContain('IMAGE_GENERATION');
    expect(poster.capabilities).toContain('SEARCH_INTERNAL');

    const presentation = routeCapabilities('来月の経営会議プレゼン作って');
    expect(presentation.capabilities).toEqual(
      expect.arrayContaining(['SEARCH_INTERNAL', 'DATA_ANALYSIS', 'CHART_GENERATION', 'PRESENTATION_CREATION', 'CRITIC_REVIEW'])
    );
    expect(presentation.budget).toBe('DEEP');

    const app = routeCapabilities('この業務をアプリにして');
    expect(app.budget).toBe('BUILD');
    expect(app.permission?.requiresApproval).toBe(true);
  });

  it('Permission: 給与データを使う資料はPRESIDENT必須（§40）', async () => {
    const route = routeCapabilities('給与一覧の資料にして');
    expect(route.permission?.requiredRole).toBe('PRESIDENT');
    // STAFFで依頼すると拒否される
    const repository = new InMemoryCommandRepository();
    const orchestrator = new CommandOrchestrator(repository);
    const res = await orchestrator.chat(
      { message: '給与一覧の資料にして', scope: 'lcc', asOf: ASOF },
      STAFF
    );
    expect(res.text).toContain('実行できません');
    expect(res.text).toContain('PRESIDENT権限');
  });
});

describe('X: Artifact Creation / Software Build / Estimate / Search', () => {
  let repository: InMemoryCommandRepository;
  let orchestrator: CommandOrchestrator;

  beforeEach(() => {
    resetToolIdSeq();
    resetMemorySeq();
    resetPlanSeq();
    resetPrincipleSeq();
    resetArtifactSeq();
    repository = new InMemoryCommandRepository();
    orchestrator = new CommandOrchestrator(repository);
  });

  it('「プレゼン作って」はCapability連鎖のPlanになり、未接続を正直に伝えてArtifact登録する（§19-§20）', async () => {
    const res = await orchestrator.chat({ message: '来月の経営会議プレゼン作って', scope: 'lcc', asOf: ASOF });
    expect(res.text).toContain('実行ステップ');
    expect(res.text).toContain('未接続');
    expect(res.text).toContain('偽って返すことはしません');
    const artifacts = await repository.getArtifacts();
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].type).toBe('PPTX');
    expect(artifacts[0].status).toBe('PLANNED');
  });

  it('Artifact Plan: PPTX連鎖はSEARCH_INTERNALから始まりCRITICで終わる（§19）', () => {
    const plan = planArtifactCreation('PPTX', '経営会議資料', { executableCapabilities: new Set(['SEARCH_INTERNAL']) });
    expect(plan.steps[0].capability).toBe('SEARCH_INTERNAL');
    expect(plan.steps[plan.steps.length - 1].capability).toBe('CRITIC_REVIEW');
    expect(plan.executable).toBe(false);
    expect(plan.blockedBy).toContain('PRESENTATION_CREATION');
  });

  it('Artifact Registry: supersedeで版と履歴を保持する（§20）', async () => {
    const service = new ArtifactService(repository);
    const first = await service.register(
      { type: 'XLSX', title: '原価表', createdBy: 'test', sourceData: [], sourceEvidence: [], sourceMemoryIds: [], status: 'COMPLETED' },
      ASOF
    );
    const second = await service.supersede(first.artifactId, { ...first, artifactId: 'art-next', status: 'COMPLETED' }, ASOF);
    expect(second.version).toBe(2);
    expect(second.supersedes).toBe(first.artifactId);
    const all = await service.list();
    expect(all.find((a) => a.artifactId === first.artifactId)?.status).toBe('SUPERSEDED');
  });

  it('Software Build: 重複チェックが既存システムを検出し「作れるから作る」を止める（§24）', async () => {
    const dup = checkDuplicates('見積と顧客管理をアプリにして');
    expect(dup.duplicates.some((d) => d.key === 'integrated-os')).toBe(true);
    expect(dup.recommendation).toBe('既存改修');

    const plan = buildSoftwarePlan('新しい入力台帳アプリを作って日報を転記したい', ['会社原則候補「正本は1つ」に反する可能性があります']);
    expect(plan.lines.join('\n')).toContain('既存改修');
    expect(plan.lines.join('\n')).toContain('正本は1つ');
    expect(plan.executable).toBe(false);

    const res = await orchestrator.chat({ message: '日報の転記を新しい入力台帳アプリにして', scope: 'lcc', asOf: ASOF });
    expect(res.text).toContain('作る前の確認');
    expect(res.text).toContain('既存システム');
  });

  it('見積Capability: 類似案件の中央値で草案を作り、AIが暗算で金額を決めない（§26）', async () => {
    const dataset = await repository.getDataset(ASOF);
    const draft = draftEstimate(dataset, '山田工務店の解体の見積案作って');
    expect(draft.workKind).toBe('解体');
    expect(draft.missingInfo.length).toBeGreaterThan(0);
    if (draft.referenceAmount !== null) {
      expect(draft.evidence.some((e) => e.label.includes('中央値'))).toBe(true);
    }
    const res = await orchestrator.chat({ message: '解体工事の見積案作って', scope: 'lcc', asOf: ASOF });
    expect(res.text).toContain('見積案（草案）');
    expect(res.text).toContain('確定に必要な情報');
    expect(res.text).toContain('この草案のまま提出しないでください');
  });

  it('統合検索: 「第13期経営計画書どれ？」に正本判定付きで答える（§29）', async () => {
    const res = await orchestrator.chat({ message: '第13期の経営計画書どれが正本？', scope: 'lcc', asOf: ASOF });
    expect(res.text).toContain('経営の聖書 第13期 v7');
    expect(res.toolsUsed).toContain('unified_search');
  });

  it('統合検索: People OSはPRESIDENT以外に返さない（§27権限）', async () => {
    const dataset = await repository.getDataset(ASOF);
    const asStaff = unifiedSearch(dataset, [], '給与制度の正本 People OS', STAFF);
    expect(asStaff.some((r) => r.title.includes('People_OS'))).toBe(false);
    const asPresident = unifiedSearch(dataset, [], '給与制度の正本 People OS', PRESIDENT);
    expect(asPresident.some((r) => r.title.includes('People_OS'))).toBe(true);
  });

  it('見つからない場所は推測せず正直に答える', async () => {
    const res = await orchestrator.chat({ message: '休暇申請ルールどこにある？', scope: 'lcc', asOf: ASOF });
    expect(res.text).toMatch(/特定できませんでした|検索結果/);
    expect(res.text).not.toContain('たぶん');
  });
});

describe('X: Data Stewardship / API', () => {
  it('重要SourceにOwner・頻度・品質責任が定義されている（§9）', () => {
    expect(DATA_STEWARDSHIP.length).toBeGreaterThanOrEqual(8);
    const nippo = findSteward('daily_reports');
    expect(nippo?.departmentOwner).toContain('工務部');
    const bible = findSteward('monthly_actuals');
    expect(bible?.updateFrequency).toContain('毎月');
    expect(bible?.evidence).toContain('経営の聖書');
  });

  it('GET /constitution /future /ai-capabilities /artifacts /stewardship /search が応答する', async () => {
    const repository = new InMemoryCommandRepository();
    const app = createCommandApp({ repository, llmHooks: {} });
    const constitution = (await (await app.request('/constitution')).json()) as { principles: unknown[] };
    expect(constitution.principles.length).toBeGreaterThanOrEqual(8);
    const future = (await (
      await app.request(`/future?scope=lcc&asOf=${encodeURIComponent(ASOF)}`)
    ).json()) as { insights: unknown[] };
    expect(future.insights.length).toBeGreaterThan(0);
    const caps = (await (await app.request('/ai-capabilities')).json()) as {
      capabilities: Array<{ capabilityId: string; status: string }>;
    };
    expect(caps.capabilities.length).toBeGreaterThanOrEqual(40);
    expect(caps.capabilities.find((c) => c.capabilityId === 'IMAGE_GENERATION')?.status).toBe('NOT_CONFIGURED');
    const stewards = (await (await app.request('/stewardship')).json()) as { stewards: unknown[] };
    expect(stewards.stewards.length).toBeGreaterThanOrEqual(8);
    const search = (await (
      await app.request(`/search?q=${encodeURIComponent('第13期の経営計画書')}&scope=lcc`)
    ).json()) as { results: Array<{ title: string }> };
    expect(search.results.some((r) => r.title.includes('経営の聖書'))).toBe(true);
    const approveDenied = await app.request('/constitution/const-001/approve', { method: 'POST' });
    // demoモードのデフォルトPrincipalはPRESIDENT → 承認成功
    expect(approveDenied.status).toBe(200);
  });
});
