/**
 * 共通Semantic Test（検収是正4 §7）。
 * 朝Brief・複合質問・KPI・Artifactのすべての経路で
 * 「未接続・不明を0円/0%へ変換しない」意味が一致することを検証する。
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { LocalCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import {
  SheetsSourceRegistry,
  type SheetTable,
  type SheetsClient
} from '../../../src/command/sources/googleSheets.js';
import type { SheetSourceConfig } from '../../../src/command/sources/canonicalMapping.js';
import type { CommandDataset } from '../../../src/command/data/seed.js';
import { generateExecutiveBrief } from '../../../src/command/brief/generateBrief.js';
import { computeSalesSummary } from '../../../src/command/engines/sales.js';
import { computeKpiSnapshot } from '../../../src/command/engines/kpi.js';
import { buildAlerts, activeAlerts } from '../../../src/command/engines/alerts.js';
import { detectSalesLeaks } from '../../../src/command/engines/salesLeak.js';
import {
  buildManagementDeckSpec,
  buildReportDocumentSpec
} from '../../../src/command/artifacts/contentBuilders.js';

const ASOF = '2026-08-09T00:00:00.000Z';
// 2026-06-29T09:30:07Z（実シートと同形式のepoch millis更新列）
const EPOCH_0629 = '1782725407000';

// 本番相当: 案件・顧客のみ接続。契約額列なし・statusはquote/contract・更新列はepoch millis。
// 銀行・会計・請求・入金は未接続（Sourceに存在しない）。
const TABLES: Record<string, SheetTable> = {
  's/projects': {
    spreadsheetId: 's',
    tabName: 'projects',
    header: ['id', 'name', 'customerId', 'status', 'estimateTotal', 'deliveryDate', 'updatedAt', 'staff'],
    rows: [
      // 受注扱い（contract→ordered暫定）だが契約額列が存在しない → orderAmount null
      ['P1', '外構工事X', 'C1', 'contract', '500000', '2026/8/20', EPOCH_0629, '藤井信男'],
      ['P2', '解体工事Y', 'C1', 'contract', '0', '2026/8/25', EPOCH_0629, '竹内和也'],
      // 未監査status → unknown
      ['P3', '草刈りZ', 'C1', 'quote', '38500', '', EPOCH_0629, ''],
      ['P4', '剪定W', 'C1', 'quote', '', '', EPOCH_0629, '']
    ],
    fetchedAt: ASOF
  },
  's/customers': {
    spreadsheetId: 's',
    tabName: 'customers',
    header: ['id', 'name'],
    rows: [['C1', '出雲商事株式会社']],
    fetchedAt: ASOF
  }
};

const CONFIGS: SheetSourceConfig[] = [
  {
    sourceName: 'ProjectSource',
    spreadsheetId: 's',
    tabName: 'projects',
    companyId: 'lcc',
    columns: {
      projectId: 'id',
      name: 'name',
      customerId: 'customerId',
      stage: 'status',
      estimateAmount: 'estimateTotal',
      dueDate: 'deliveryDate',
      sourceUpdatedAt: 'updatedAt',
      ownerName: 'staff'
    },
    stageMap: { contract: 'ordered' }
  },
  {
    sourceName: 'CustomerSource',
    spreadsheetId: 's',
    tabName: 'customers',
    companyId: 'lcc',
    columns: { customerId: 'id', name: 'name' }
  }
];

class StaticClient implements SheetsClient {
  async fetchTable(spreadsheetId: string, tabName: string): Promise<SheetTable> {
    const table = TABLES[`${spreadsheetId}/${tabName}`];
    if (!table) throw new Error('not found');
    return table;
  }
}

let dataset: CommandDataset;
let orchestrator: CommandOrchestrator;

beforeAll(async () => {
  const registry = new SheetsSourceRegistry(new StaticClient(), CONFIGS, {
    companies: [{ companyId: 'lcc', name: '株式会社LCC' }]
  });
  dataset = await registry.compose(ASOF);
  const dir = await mkdtemp(join(tmpdir(), 'lcc-sem-'));
  orchestrator = new CommandOrchestrator(new LocalCommandRepository(join(dir, 'store.json'), registry));
});

describe('§7 共通Semantic Test（UNKNOWN→0変換の禁止・全経路一致）', () => {
  it('朝Brief: 銀行未接続の現預金が0円にならず「判定不能」', () => {
    const brief = generateExecutiveBrief(dataset, 'lcc');
    expect(brief.text).toContain('現預金: 銀行未接続のため判定不能');
    expect(brief.text).not.toMatch(/現預金\s*0円/);
    expect(brief.text).toContain('現金予測: 銀行未接続のため判定不能');
  });

  it('朝Brief: 会計未接続の当月売上・請求未接続の完工未請求が0円にならない', () => {
    const brief = generateExecutiveBrief(dataset, 'lcc');
    expect(brief.text).toContain('当月売上: 会計・請求Source未接続のため判定不能');
    expect(brief.text).toContain('完工未請求: 請求Source未接続のため判定不能');
    expect(brief.text).not.toMatch(/当月売上\s*0円/);
    expect(brief.text).not.toMatch(/完工未請求\s*0円/);
  });

  it('複合質問: 接続フラグ未確認のyen(0)を出さない（確定売上・現預金・請求）', async () => {
    const res = await orchestrator.chat({
      message: '資金と売上と請求の状況をまとめて教えて',
      scope: 'lcc',
      asOf: ASOF,
      sessionId: 'sem-compound'
    });
    expect(res.text).toContain('銀行未接続のため判定不能');
    expect(res.text).toContain('会計・請求Source未接続のため判定不能');
    expect(res.text).toContain('請求Source未接続のため判定不能');
    expect(res.text).not.toMatch(/現預金\s*0円/);
    expect(res.text).not.toMatch(/確定\s*0円/);
    expect(res.text).not.toMatch(/完工未請求\s*0円/);
  });

  it('カバレッジ0% → 着地予測・受注残総額はnull（算出不能）で、0円と表示しない', () => {
    const sales = computeSalesSummary(dataset, 'lcc');
    expect(sales.orderedCount).toBe(2);
    expect(sales.amountKnownCount).toBe(0); // 契約額列なし
    expect(sales.coverageRate).toBe(0);
    expect(sales.landingForecast).toBeNull();
    expect(sales.orderBacklog).toBeNull();
    const kpi = computeKpiSnapshot(dataset, 'lcc', buildAlerts(dataset, 'lcc', []));
    const landing = kpi.kpis.find((k) => k.key === 'sales_landing');
    const backlog = kpi.kpis.find((k) => k.key === 'order_backlog');
    expect(landing?.value).toBeNull();
    expect(landing?.confidence).toBe('UNKNOWN');
    expect(backlog?.value).toBeNull();
    expect(backlog?.label).toContain('カバレッジ0%');
  });

  it('margin未接続 → KPI valueはnull（0%を入れない）', () => {
    const kpi = computeKpiSnapshot(dataset, 'lcc', buildAlerts(dataset, 'lcc', []));
    const margin = kpi.kpis.find((k) => k.key === 'margin_forecast');
    expect(margin?.value).toBeNull();
    expect(margin?.confidence).toBe('UNKNOWN');
  });

  it('Freshness: Source実更新6/29・取得8/9 → VERY_STALEと判定し、同期日時と分離する', () => {
    const kpi = computeKpiSnapshot(dataset, 'lcc', buildAlerts(dataset, 'lcc', []));
    const backlog = kpi.kpis.find((k) => k.key === 'order_backlog');
    expect(backlog?.freshness.lastUpdatedAt).toBe(new Date(Number(EPOCH_0629)).toISOString());
    expect(backlog?.freshnessStatus).toBe('VERY_STALE');
    expect(backlog?.syncedAt).toBe(ASOF); // 同期日時（取得）はデータ最終更新と別項目
  });

  it('PROVISIONAL stage由来のAlertは候補扱いでHIGHにしない', () => {
    const leaks = detectSalesLeaks(dataset, 'lcc');
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.every((leak) => leak.provisional)).toBe(true);
    expect(leaks.every((leak) => leak.confidence !== 'HIGH')).toBe(true);
    expect(leaks.some((leak) => leak.title === '次工程未設定候補')).toBe(true);
    const alerts = activeAlerts(buildAlerts(dataset, 'lcc', []));
    expect(
      alerts.filter((a) => a.kind === 'no_next_step').every((a) => a.severity === 'WATCH')
    ).toBe(true);
    const kpi = computeKpiSnapshot(dataset, 'lcc', buildAlerts(dataset, 'lcc', []));
    const actions = kpi.kpis.find((k) => k.key === 'sales_actions');
    expect(actions?.confidence).toBe('MEDIUM');
    expect(actions?.label).toContain('候補');
  });

  it('UI/Chat/Brief/PPTX/PDFで意味が一致する（算出不能・判定不能・0円非表示）', async () => {
    const brief = generateExecutiveBrief(dataset, 'lcc');
    const deck = buildManagementDeckSpec(dataset, 'lcc');
    const deckText = deck.slides.flatMap((s) => s.bullets ?? []).join('\n');
    const report = buildReportDocumentSpec(dataset, 'lcc');
    const reportText = report.sections.flatMap((s) => s.paragraphs).join('\n');
    const chat = await orchestrator.chat({
      message: '今月の売上どう？',
      scope: 'lcc',
      asOf: ASOF,
      sessionId: 'sem-single'
    });
    for (const text of [brief.text, deckText, reportText, chat.text]) {
      expect(text).toContain('算出不能');
      expect(text).toContain('判定不能');
      expect(text).not.toMatch(/着地予測[：:]?\s*0円/);
      expect(text).not.toMatch(/受注残[：:]?\s*0円/);
    }
    // 着地算出不能時はPPTXの売上グラフを描かない（0円の棒=架空表示）
    const salesSlide = deck.slides.find((s) => s.title === '売上・着地');
    expect(salesSlide?.chart).toBeUndefined();
  });
});
