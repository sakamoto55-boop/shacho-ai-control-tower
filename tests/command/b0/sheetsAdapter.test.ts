import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RestSheetsClient,
  SheetsSourceRegistry,
  SnapshotSheetsClient,
  type SheetTable,
  type SheetsClient
} from '../../../src/command/sources/googleSheets.js';
import type { SheetSourceConfig } from '../../../src/command/sources/canonicalMapping.js';
import {
  parseAmount,
  parseDateCell,
  parseStage
} from '../../../src/command/sources/canonicalMapping.js';
import { datasetAvailability } from '../../../src/command/sources/SourceAdapter.js';

const ASOF = '2026-08-08T00:00:00.000Z';

const PROJECT_TABLE: SheetTable = {
  spreadsheetId: 'sheet-tougou',
  tabName: '案件',
  header: [
    '案件ID',
    '案件名',
    '顧客ID',
    'ステータス',
    '受注額',
    '予定粗利率',
    '完工予定日',
    '完工日'
  ],
  rows: [
    ['PJ-001', '出雲市倉庫解体', 'C-01', '施工中', '¥1,500,000', '30', '2026/8/20', ''],
    ['PJ-002', '松江市外構工事', 'C-02', '完工', '3,000,000円', '28', '', '2026/8/5'],
    ['PJ-003', '斐川改修', 'C-01', '入金済', '2,000,000', '25', '', '2026/8/2']
  ],
  fetchedAt: ASOF
};

const CUSTOMER_TABLE: SheetTable = {
  spreadsheetId: 'sheet-tougou',
  tabName: '顧客',
  header: ['顧客ID', '顧客名', '電話'],
  rows: [
    ['C-01', '出雲商事株式会社', '0853-00-0000'],
    ['C-02', '松江ハウス', '']
  ],
  fetchedAt: ASOF
};

const SCHEDULE_TABLE: SheetTable = {
  spreadsheetId: 'sheet-haichi',
  tabName: '配置',
  header: ['日付', '現場名', '作業員', '案件ID', '車両'],
  rows: [
    ['2026/8/8', '出雲市倉庫解体現場', '田中', 'PJ-001', '2tダンプ'],
    ['2026/8/8', '出雲市倉庫解体現場', '佐藤', 'PJ-001', ''],
    ['2026/8/7', '松江市外構現場', '田中', 'PJ-002', '']
  ],
  fetchedAt: ASOF
};

const REPORT_TABLE: SheetTable = {
  spreadsheetId: 'sheet-haichi',
  tabName: '日報',
  header: ['日付', '現場名', '作業員', '人工', '案件ID', '作業内容'],
  rows: [['2026/8/7', '出雲市倉庫解体現場', '田中', '1', 'PJ-001', '内装解体']],
  fetchedAt: ASOF
};

function makeConfigs(): SheetSourceConfig[] {
  return [
    {
      sourceName: 'ProjectSource',
      spreadsheetId: 'sheet-tougou',
      tabName: '案件',
      companyId: 'lcc',
      columns: {
        projectId: '案件ID',
        name: '案件名',
        customerId: '顧客ID',
        stage: 'ステータス',
        contractAmount: '受注額',
        plannedMarginPercent: '予定粗利率',
        dueDate: '完工予定日',
        completedDate: '完工日'
      }
    },
    {
      sourceName: 'CustomerSource',
      spreadsheetId: 'sheet-tougou',
      tabName: '顧客',
      companyId: 'lcc',
      columns: { customerId: '顧客ID', name: '顧客名', phone: '電話' }
    },
    {
      sourceName: 'ScheduleSource',
      spreadsheetId: 'sheet-haichi',
      tabName: '配置',
      companyId: 'lcc',
      columns: {
        date: '日付',
        siteName: '現場名',
        employeeName: '作業員',
        projectId: '案件ID',
        vehicle: '車両'
      }
    },
    {
      sourceName: 'DailyReportSource',
      spreadsheetId: 'sheet-haichi',
      tabName: '日報',
      companyId: 'lcc',
      columns: {
        date: '日付',
        siteName: '現場名',
        employeeName: '作業員',
        manDays: '人工',
        projectId: '案件ID',
        workDescription: '作業内容'
      }
    }
  ];
}

class FakeSheetsClient implements SheetsClient {
  constructor(
    private readonly tables: Record<string, SheetTable>,
    private readonly failFor: string[] = []
  ) {}

  async fetchTable(spreadsheetId: string, tabName: string): Promise<SheetTable> {
    const key = `${spreadsheetId}/${tabName}`;
    if (this.failFor.includes(key)) throw new Error('Source timeout');
    const table = this.tables[key];
    if (!table) throw new Error(`not found: ${key}`);
    return table;
  }
}

const ALL_TABLES = {
  'sheet-tougou/案件': PROJECT_TABLE,
  'sheet-tougou/顧客': CUSTOMER_TABLE,
  'sheet-haichi/配置': SCHEDULE_TABLE,
  'sheet-haichi/日報': REPORT_TABLE
};

const COMPANIES = [{ companyId: 'lcc', name: '株式会社LCC' }];

describe('B0: Google Sheets READ ONLY Adapter', () => {
  it('日本語シートをCanonical Modelへ変換する（既存IDはCrosswalkで保持）', async () => {
    const registry = new SheetsSourceRegistry(new FakeSheetsClient(ALL_TABLES), makeConfigs(), {
      companies: COMPANIES
    });
    const dataset = await registry.compose(ASOF);

    expect(dataset.meta.mode).toBe('production');
    expect(dataset.projects).toHaveLength(3);
    const pj1 = dataset.projects.find((p) => p.externalIds?.sheet === 'PJ-001')!;
    expect(pj1.projectId).toBe('prj:PJ-001'); // 既存IDを振り直さない
    expect(pj1.stage).toBe('in_progress'); // 施工中→canonical
    expect(pj1.orderAmount).toBe(1_500_000); // ¥・カンマ除去
    expect(pj1.plannedMarginRate).toBeCloseTo(0.3, 5);
    expect(pj1.dueDate).toBe('2026-08-20');
    expect(pj1.customerId).toBe('cust:C-01');

    expect(dataset.customers).toHaveLength(2);
    expect(dataset.assignments).toHaveLength(3);
    expect(dataset.dailyReports).toHaveLength(1);
    expect(dataset.dailyReports[0].manDays).toBe(1);
  });

  it('Source別のfreshness・provenance・readOnly・scopeを返す', async () => {
    const registry = new SheetsSourceRegistry(new FakeSheetsClient(ALL_TABLES), makeConfigs(), {
      companies: COMPANIES
    });
    const dataset = await registry.compose(ASOF);
    const project = dataset.meta.sources.find((s) => s.sourceName === 'ProjectSource')!;
    expect(project.sourceType).toBe('google_sheets');
    expect(project.readOnly).toBe(true);
    expect(project.scope).toBe('lcc');
    expect(project.lastSuccessfulSync).toBe(ASOF);
    expect(project.freshness?.source).toContain('Google Sheets');
    // 未設定Source（会計・銀行等）はUNKNOWNのまま明示
    const accounting = dataset.meta.sources.find((s) => s.sourceName === 'AccountingSource')!;
    expect(accounting.errorState).toContain('UNKNOWN');
  });

  it('schema validation: 必須列がなければerrorStateにする（黙って空にしない）', async () => {
    const broken = {
      ...ALL_TABLES,
      'sheet-tougou/案件': { ...PROJECT_TABLE, header: ['番号', '名称'] }
    };
    const registry = new SheetsSourceRegistry(new FakeSheetsClient(broken), makeConfigs(), {
      companies: COMPANIES
    });
    const dataset = await registry.compose(ASOF);
    const project = dataset.meta.sources.find((s) => s.sourceName === 'ProjectSource')!;
    expect(project.errorState).toContain('schema validation');
    expect(dataset.projects).toHaveLength(0);
  });

  it('部分障害: 1ソース失敗でも他ソースは生き、PARTIALになる', async () => {
    const registry = new SheetsSourceRegistry(
      new FakeSheetsClient(ALL_TABLES, ['sheet-haichi/日報']),
      makeConfigs(),
      { companies: COMPANIES }
    );
    const dataset = await registry.compose(ASOF);
    expect(
      dataset.meta.sources.find((s) => s.sourceName === 'DailyReportSource')?.errorState
    ).toContain('CONNECTION ERROR');
    expect(dataset.projects.length).toBeGreaterThan(0);
    expect(datasetAvailability(dataset)).toBe('PARTIAL');
  });

  it('RestSheetsClient: GETのみ・retryあり・timeoutあり', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    let failures = 1;
    const fetchOk = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      if (failures > 0) {
        failures -= 1;
        throw new Error('ECONNRESET');
      }
      return new Response(JSON.stringify({ values: [['案件ID'], ['PJ-001']] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new RestSheetsClient({
      apiKey: 'test',
      fetchImpl: fetchOk,
      retries: 2,
      timeoutMs: 1000
    });
    const table = await client.fetchTable('sid', '案件');
    expect(table.header).toEqual(['案件ID']);
    expect(calls.length).toBe(2); // 1回失敗→リトライで成功
    expect(calls.every((call) => (call.method ?? 'GET') === 'GET')).toBe(true); // READ ONLY

    const fetchHang = ((url: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const slowClient = new RestSheetsClient({ fetchImpl: fetchHang, retries: 0, timeoutMs: 30 });
    await expect(slowClient.fetchTable('sid', '案件')).rejects.toThrow(/Sheets取得失敗/);
  });

  it('SnapshotSheetsClient: 発見フェーズのエクスポートを読める', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lcc-snap-'));
    await writeFile(join(dir, 'sheet-tougou__案件.json'), JSON.stringify(PROJECT_TABLE), 'utf8');
    const client = new SnapshotSheetsClient(dir);
    const table = await client.fetchTable('sheet-tougou', '案件');
    expect(table.rows).toHaveLength(3);
  });

  it('セルパーサ: 金額・日付・ステータスの表記ゆれを吸収する', () => {
    expect(parseAmount('¥1,234,567円')).toBe(1_234_567);
    expect(parseAmount('１２３')).toBe(123);
    expect(parseAmount('未定')).toBeNull();
    expect(parseDateCell('2026/8/8')).toBe('2026-08-08');
    expect(parseDateCell('2026年8月8日')).toBe('2026-08-08');
    expect(parseDateCell('不明')).toBeNull();
    expect(parseStage('施工中')).toBe('in_progress');
    expect(parseStage('謎ステータス')).toBeNull();
  });
});
