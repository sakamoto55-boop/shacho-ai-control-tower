import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, statSync, rmSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import { createCommandApp } from '../../../src/command/server/routes.js';
import {
  GeminiCommandModelProvider,
  ManusAdapter,
  OpenAICommandModelProvider,
  OpenAIImageProvider,
  liveProviderStatus,
  parsePreferredProvider
} from '../../../src/command/ai/liveProviders.js';
import { ModelRouter, type CommandModelProvider } from '../../../src/command/ai/ModelRouter.js';
import { runProviderBenchmark } from '../../../src/command/evaluation/providerBenchmark.js';
import {
  renderChartSvg,
  renderDocument,
  renderFlowDiagramSvg,
  renderPdf,
  renderPresentation,
  renderWorkbook
} from '../../../src/command/artifacts/renderers.js';
import {
  buildEstimateWorkbookSpec,
  buildManagementDeckSpec
} from '../../../src/command/artifacts/contentBuilders.js';
import { draftEstimate } from '../../../src/command/estimate/estimateCapability.js';
import { BuildTaskManager, resetBuildSeq } from '../../../src/command/build/codingAgentBridge.js';
import {
  CONSTITUTION_CANDIDATES,
  resetPrincipleSeq
} from '../../../src/command/constitution/constitutionRegistry.js';
import { CommandEventBus } from '../../../src/command/events/eventBus.js';
import { resetArtifactSeq } from '../../../src/command/artifacts/artifactRegistry.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';
import { resetMemorySeq } from '../../../src/command/memory/store.js';
import { resetPlanSeq } from '../../../src/command/agents/rolePlanner.js';

const ASOF = '2026-08-08T00:00:00.000Z';

const fakeFetch = (handler: (url: string, init?: RequestInit) => unknown): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) =>
    new Response(JSON.stringify(handler(String(url), init)), { status: 200 })) as typeof fetch;

describe('LIVE-AI: Constitution最終候補', () => {
  it('印刷版PDF本文からVision/Mission/Values/安全/品質/財務/DXが抽出され、20原則になった', () => {
    expect(CONSTITUTION_CANDIDATES.length).toBe(20);
    const byCategory = (cat: string) => CONSTITUTION_CANDIDATES.filter((p) => p.category === cat);
    expect(byCategory('MISSION').length).toBe(1);
    expect(byCategory('VISION').length).toBe(1);
    expect(byCategory('VALUES').length).toBe(1);
    expect(byCategory('SAFETY_POLICY').length).toBe(1);
    expect(byCategory('QUALITY_POLICY').length).toBe(1);
    const mission = byCategory('MISSION')[0];
    expect(mission.statement).toContain('ありがとう');
    expect(mission.source).toContain('経営計画書（3校）');
    // §4: 不動産15.0はRECOMMENDED_CANDIDATE
    const goal = CONSTITUTION_CANDIDATES.find((p) => p.principleId === 'const-007');
    expect(goal?.recommended).toBe(true);
    expect(goal?.evidence.some((e) => e.value.includes('RECOMMENDED_CANDIDATE'))).toBe(true);
    // 優先レビュー対象（§3）が設定されている
    expect(CONSTITUTION_CANDIDATES.filter((p) => p.priorityReview).length).toBeGreaterThanOrEqual(6);
  });
});

describe('LIVE-AI: Provider Adapters（§8-§11・§38）', () => {
  it('OpenAI Adapter: chat completionsを正しく呼びテキストを返す', async () => {
    const provider = new OpenAICommandModelProvider('sk-test', 'gpt-5', fakeFetch((url, init) => {
      expect(url).toContain('api.openai.com/v1/chat/completions');
      const body = JSON.parse(String(init?.body)) as { model: string; messages: unknown[] };
      expect(body.model).toBe('gpt-5');
      expect(body.messages).toHaveLength(2);
      return { choices: [{ message: { content: 'openai回答' } }] };
    }));
    const text = await provider.complete({ purpose: 'conversation', systemPrompt: 'sys', userMessage: 'q' });
    expect(text).toBe('openai回答');
  });

  it('Gemini Adapter: generateContentを正しく呼びテキストを返す', async () => {
    const provider = new GeminiCommandModelProvider('g-key', 'gemini-2.5-pro', fakeFetch((url) => {
      expect(url).toContain('generativelanguage.googleapis.com');
      expect(url).toContain('gemini-2.5-pro');
      return { candidates: [{ content: { parts: [{ text: 'gemini回答' }] } }] };
    }));
    const text = await provider.complete({ purpose: 'conversation', systemPrompt: 'sys', userMessage: 'q' });
    expect(text).toBe('gemini回答');
  });

  it('Manus Adapter: 非同期タスクを発行しtaskRefを返す', async () => {
    const adapter = new ManusAdapter('m-key', 'https://api.manus.ai', fakeFetch((url) => {
      expect(url).toBe('https://api.manus.ai/v1/tasks');
      return { taskId: 'task-123' };
    }));
    const { taskRef } = await adapter.submitTask({ kind: 'DEEP_RESEARCH', instruction: '市場調査' });
    expect(taskRef).toBe('task-123');
  });

  it('Image Adapter: base64画像を返す（未設定はNOT_CONFIGURED扱い）', async () => {
    const provider = new OpenAIImageProvider('sk-test', 'gpt-image-1', fakeFetch(() => ({
      data: [{ b64_json: 'aW1n' }]
    })));
    const { base64Png } = await provider.generateImage('チラシ用画像');
    expect(base64Png).toBe('aW1n');
    const status = liveProviderStatus({});
    expect(status.imageGeneration).toBe(false);
  });

  it('§38 Provider指定: 「Claudeで」「Geminiでも」を解釈し、Routerが優先候補にする', async () => {
    expect(parsePreferredProvider('Claudeで考えて')).toBe('anthropic');
    expect(parsePreferredProvider('Geminiでも確認して')).toBe('gemini');
    expect(parsePreferredProvider('Manusで徹底調査')).toBe('manus');
    expect(parsePreferredProvider('今月どう？')).toBeNull();

    const a: CommandModelProvider = { providerId: 'a', complete: async () => 'A' };
    const b: CommandModelProvider = { providerId: 'b', complete: async () => 'B' };
    const router = new ModelRouter({ routes: {}, defaultRoute: ['a', 'b'] });
    router.register(a);
    router.register(b);
    const preferred = await router.complete(
      { purpose: 'conversation', systemPrompt: '', userMessage: '' },
      'b'
    );
    expect(preferred.providerId).toBe('b');
  });

  it('Provider Benchmark: 複数Providerの品質・Latency・Structured成功率を記録する（§12）', async () => {
    let t = 0;
    const fast: CommandModelProvider = { providerId: 'fast', complete: async () => '{"sum":3} 粗利とは。' };
    const broken: CommandModelProvider = {
      providerId: 'broken',
      complete: async () => {
        throw new Error('down');
      }
    };
    const report = await runProviderBenchmark(
      [fast, broken],
      [
        { id: 'q1', question: 'sum', structured: true },
        { id: 'q2', question: '粗利とは', expectText: ['粗利'] }
      ],
      () => (t += 10)
    );
    const fastSummary = report.summary.find((s) => s.providerId === 'fast');
    expect(fastSummary?.okRate).toBe(1);
    expect(fastSummary?.structuredOkRate).toBe(1);
    expect(fastSummary?.accuracyRate).toBe(1);
    const brokenSummary = report.summary.find((s) => s.providerId === 'broken');
    expect(brokenSummary?.okRate).toBe(0);
    expect(report.records.find((r) => r.providerId === 'broken')?.error).toBe('down');
  });
});

describe('LIVE-AI: 実ファイル生成Renderer（§16-§22）', () => {
  let repository: InMemoryCommandRepository;

  beforeEach(() => {
    resetToolIdSeq();
    resetMemorySeq();
    resetPlanSeq();
    resetPrincipleSeq();
    resetArtifactSeq();
    resetBuildSeq();
    repository = new InMemoryCommandRepository();
  });

  it('PPTX: 経営会議プレゼンを決定論データから実ファイル生成する', async () => {
    const dataset = await repository.getDataset(ASOF);
    const spec = buildManagementDeckSpec(dataset, 'lcc');
    expect(spec.slides.length).toBeGreaterThanOrEqual(3);
    const path = await renderPresentation(spec, 'test-deck');
    expect(statSync(path).size).toBeGreaterThan(10_000);
    expect(readFileSync(path).subarray(0, 2).toString('latin1')).toBe('PK'); // OOXML zip
    rmSync(path, { force: true });
  });

  it('XLSX: 見積草案Workbook（数式・検証・複数シート）を生成し再読込できる', async () => {
    const dataset = await repository.getDataset(ASOF);
    const draft = draftEstimate(dataset, '解体の見積案作って');
    const spec = buildEstimateWorkbookSpec(draft, ASOF);
    const path = await renderWorkbook(spec, 'test-estimate');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    expect(workbook.worksheets.length).toBe(2);
    const cell = workbook.getWorksheet('見積案')?.getCell('D2');
    expect(cell?.formula).toBe('B2*C2');
    rmSync(path, { force: true });
  });

  it('DOCX/PDF: 経営報告書を生成する', async () => {
    const dataset = await repository.getDataset(ASOF);
    const { buildReportDocumentSpec } = await import('../../../src/command/artifacts/contentBuilders.js');
    const spec = buildReportDocumentSpec(dataset, 'lcc');
    const docxPath = await renderDocument(spec, 'test-report');
    expect(readFileSync(docxPath).subarray(0, 2).toString('latin1')).toBe('PK');
    const pdfPath = await renderPdf(spec, 'test-report');
    expect(readFileSync(pdfPath).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    rmSync(docxPath, { force: true });
    rmSync(pdfPath, { force: true });
  });

  it('Chart/Diagram SVG: 決定論データのみから生成（AIに値を作らせない）', () => {
    const chart = renderChartSvg({ title: '売上推移', labels: ['4月', '5月'], values: [100, 200] });
    expect(chart).toContain('<svg');
    expect(chart).toContain('売上推移');
    const diagram = renderFlowDiagramSvg({ title: '業務フロー', steps: ['見積', '受注', '施工'] });
    expect(diagram).toContain('受注');
    expect(diagram).toContain('marker');
  });

  it('会話「経営会議のプレゼン作って」で実PPTXが生成されArtifact Registryに記録される（§36）', async () => {
    const bus = new CommandEventBus();
    const orchestrator = new CommandOrchestrator(repository, { eventBus: bus });
    const res = await orchestrator.chat({ message: '経営会議のプレゼン作って', scope: 'lcc', asOf: ASOF });
    expect(res.text).toContain('PPTXを生成しました');
    expect(res.text).toContain('決定論エンジン');
    const artifacts = await repository.getArtifacts();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].status).toBe('COMPLETED');
    expect(artifacts[0].storageLocation).toBeTruthy();
    expect(statSync(artifacts[0].storageLocation as string).size).toBeGreaterThan(10_000);
    // §36: 進捗イベント（生成中表示）がEvent Busへ流れる
    const events = bus.recent(100);
    expect(events.some((e) => e.displayLabel?.includes('スライド'))).toBe(true);
    rmSync(artifacts[0].storageLocation as string, { force: true });
  });

  it('画像生成は未接続を正直に伝える（§46: できますと言わない）', async () => {
    const orchestrator = new CommandOrchestrator(repository);
    const res = await orchestrator.chat({ message: 'チラシ用の画像作って', scope: 'lcc', asOf: ASOF });
    expect(res.text).toContain('未接続');
    expect(res.text).toContain('偽って返すことはしません');
    const artifacts = await repository.getArtifacts();
    expect(artifacts[0].status).toBe('PLANNED');
  });

  it('生成済みArtifactを「前に作った○○どれ？」で検索できる（§30）', async () => {
    const orchestrator = new CommandOrchestrator(repository);
    await orchestrator.chat({ message: '経営会議のプレゼン作って', scope: 'lcc', asOf: ASOF });
    const res = await orchestrator.chat({ message: '前に作った経営会議の資料どれ？', scope: 'lcc', asOf: ASOF });
    expect(res.text).toContain('PPTX');
    expect(res.evidence.length).toBeGreaterThan(0);
    const artifacts = await repository.getArtifacts();
    if (artifacts[0].storageLocation) rmSync(artifacts[0].storageLocation, { force: true });
  });
});

describe('LIVE-AI: Build Task / Outcome Learning', () => {
  beforeEach(() => {
    resetBuildSeq();
    resetArtifactSeq();
    resetMemorySeq();
  });

  it('Build Taskは承認なしでCOMPLETED（Deploy）へ進めない（§27-§28）', () => {
    const manager = new BuildTaskManager(null);
    expect(manager.agentConfigured).toBe(false);
    const task = manager.create('日報アプリ改修', ASOF);
    manager.advance(task.buildId, ASOF); // BUILDING
    manager.advance(task.buildId, ASOF); // TESTING
    manager.advance(task.buildId, ASOF); // REVIEW
    manager.advance(task.buildId, ASOF); // WAITING_APPROVAL
    expect(task.status).toBe('WAITING_APPROVAL');
    expect(() => manager.advance(task.buildId, ASOF)).toThrow('自動Deployは禁止');
    manager.advance(task.buildId, ASOF, { approvedBy: '社長' });
    expect(task.status).toBe('COMPLETED');
    expect(task.history.length).toBe(6);
  });

  it('Coding Agent未接続時のdispatchは正直にNOT_CONFIGUREDを返す', async () => {
    const manager = new BuildTaskManager(null);
    const task = manager.create('自動化', ASOF);
    const result = await manager.dispatch(task.buildId, {
      requirements: 'r',
      acceptanceTests: [],
      safetyRules: []
    });
    expect(result.dispatched).toBe(false);
    expect(result.reason).toContain('NOT_CONFIGURED');
  });

  it('POST /artifacts/:id/outcome で効果を記録しLESSONがMemoryへ還元される（§31）', async () => {
    const repository = new InMemoryCommandRepository();
    const app = createCommandApp({ repository, llmHooks: {} });
    await app.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '経営会議のプレゼン作って', scope: 'lcc', asOf: ASOF })
    });
    const artifacts = await repository.getArtifacts();
    const res = await app.request(`/artifacts/${artifacts[0].artifactId}/outcome`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: '会議準備時間が半分になった' })
    });
    expect(res.status).toBe(200);
    const memories = await repository.getMemories();
    expect(memories.some((m) => m.type === 'LESSON' && m.statement.includes('半分'))).toBe(true);
    if (artifacts[0].storageLocation) rmSync(artifacts[0].storageLocation, { force: true });
  });
});
