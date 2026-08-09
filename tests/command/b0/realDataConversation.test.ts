import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandOrchestrator } from '../../../src/command/orchestrator/orchestrator.js';
import { LocalCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import {
  SheetsSourceRegistry,
  type SheetTable,
  type SheetsClient
} from '../../../src/command/sources/googleSheets.js';
import type { SheetSourceConfig } from '../../../src/command/sources/canonicalMapping.js';
import { resetToolIdSeq } from '../../../src/command/tools/registry.js';

const ASOF = '2026-08-08T00:00:00.000Z'; // JST 8/8

// Demo Fixtureの代表数値。実データ会話へ混入したら隔離違反
const DEMO_NUMBERS = ['15,500,000', '23,225,000', '12,400,000', '18,000,000'];

const TABLES: Record<string, SheetTable> = {
  'sheet-tougou/案件': {
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
      ['PJ-001', '出雲市倉庫解体', 'C-01', '施工中', '1,500,000', '30', '2026/8/20', ''],
      ['PJ-002', '松江市外構工事', 'C-02', '完工', '3,000,000', '28', '', '2026/8/5'],
      ['PJ-003', '斐川改修', 'C-01', '入金済', '2,000,000', '25', '', '2026/8/2'],
      ['PJ-004', '大田市 見積案件', 'C-02', '見積中', '', '', '', '']
    ],
    fetchedAt: ASOF
  },
  'sheet-tougou/顧客': {
    spreadsheetId: 'sheet-tougou',
    tabName: '顧客',
    header: ['顧客ID', '顧客名'],
    rows: [
      ['C-01', '出雲商事株式会社'],
      ['C-02', '松江ハウス']
    ],
    fetchedAt: ASOF
  },
  'sheet-tougou/見積': {
    spreadsheetId: 'sheet-tougou',
    tabName: '見積',
    header: ['見積番号', '案件ID', '見積額', '提出日'],
    rows: [['M-100', 'PJ-004', '4,800,000', '2026/8/1']],
    fetchedAt: ASOF
  },
  'sheet-tougou/原価': {
    spreadsheetId: 'sheet-tougou',
    tabName: '原価',
    header: ['案件ID', '区分', '金額', '日付', '種別'],
    rows: [
      ['PJ-001', '外注費', '600,000', '2026/8/3', '実績'],
      ['PJ-001', '処分費', '200,000', '2026/8/4', '実績'],
      ['PJ-001', '外注費', '1,050,000', '2026/7/20', '予定']
    ],
    fetchedAt: ASOF
  },
  'sheet-haichi/配置': {
    spreadsheetId: 'sheet-haichi',
    tabName: '配置',
    header: ['日付', '現場名', '作業員', '案件ID'],
    rows: [
      ['2026/8/8', '出雲市倉庫解体現場', '田中', 'PJ-001'],
      ['2026/8/8', '出雲市倉庫解体現場', '山本', 'PJ-001']
    ],
    fetchedAt: ASOF
  },
  'sheet-haichi/日報': {
    spreadsheetId: 'sheet-haichi',
    tabName: '日報',
    header: ['日付', '現場名', '作業員', '人工', '案件ID', '作業内容'],
    rows: [['2026/8/7', '出雲市倉庫解体現場', '田中', '1', 'PJ-001', '内装解体']],
    fetchedAt: ASOF
  }
};

const CONFIGS: SheetSourceConfig[] = [
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
    columns: { customerId: '顧客ID', name: '顧客名' }
  },
  {
    sourceName: 'EstimateSource',
    spreadsheetId: 'sheet-tougou',
    tabName: '見積',
    companyId: 'lcc',
    columns: {
      estimateId: '見積番号',
      projectId: '案件ID',
      amount: '見積額',
      submittedAt: '提出日'
    }
  },
  {
    sourceName: 'CostSource',
    spreadsheetId: 'sheet-tougou',
    tabName: '原価',
    companyId: 'lcc',
    columns: { projectId: '案件ID', category: '区分', amount: '金額', date: '日付', kind: '種別' }
  },
  {
    sourceName: 'ScheduleSource',
    spreadsheetId: 'sheet-haichi',
    tabName: '配置',
    companyId: 'lcc',
    columns: { date: '日付', siteName: '現場名', employeeName: '作業員', projectId: '案件ID' }
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

class StaticClient implements SheetsClient {
  async fetchTable(spreadsheetId: string, tabName: string): Promise<SheetTable> {
    const table = TABLES[`${spreadsheetId}/${tabName}`];
    if (!table) throw new Error('not found');
    return table;
  }
}

describe('B0: 実データ（Sheets）READ ONLYでの会話検証', () => {
  let orchestrator: CommandOrchestrator;

  beforeEach(async () => {
    resetToolIdSeq();
    const dir = await mkdtemp(join(tmpdir(), 'lcc-b0-'));
    const registry = new SheetsSourceRegistry(new StaticClient(), CONFIGS, {
      companies: [{ companyId: 'lcc', name: '株式会社LCC' }]
    });
    const repository = new LocalCommandRepository(join(dir, 'store.json'), registry);
    orchestrator = new CommandOrchestrator(repository);
  });

  const chat = (message: string) =>
    orchestrator.chat({ message, scope: 'lcc', asOf: ASOF, sessionId: 'b0' });

  it('「今日の現場は？」に配置板の予定を実績と区別して答える', async () => {
    const res = await chat('今日の現場は？');
    expect(res.text).toContain('出雲市倉庫解体現場');
    expect(res.text).toContain('田中');
    expect(res.text).toContain('予定');
    expect(res.evidence.some((ev) => ev.source.includes('予定'))).toBe(true);
  });

  it('「昨日誰がどこに行った？」に実績日報で答える', async () => {
    const res = await chat('昨日誰がどこに行った？');
    expect(res.text).toContain('実績日報');
    expect(res.text).toContain('田中');
    expect(res.text).toContain('1人工');
  });

  it('「今月の売上どう？」に実データの確定売上と着地を答え、目標未設定を明示する', async () => {
    const res = await chat('今月の売上どう？');
    // PJ-002(3M) + PJ-003(2M) 完工/入金済 = 確定5M、PJ-001(1.5M)当月完工予定 → 着地6.5M
    expect(res.text).toContain('5,000,000円');
    expect(res.text).toContain('6,500,000円');
    expect(res.text).toContain('目標が設定されていない');
    for (const num of DEMO_NUMBERS) expect(res.text).not.toContain(num);
  });

  it('「請求漏れ候補は？」に完工未請求を検出する', async () => {
    const res = await chat('請求漏れてない？');
    expect(res.text).toContain('松江市外構工事');
    expect(res.text).toContain('3,000,000');
  });

  it('「この案件いくら原価かかってる？」相当（案件カード）が実データ原価で答える', async () => {
    const res = await chat('出雲市倉庫解体はなぜ利益悪い？');
    // 実績 600,000+200,000 / 予定 1,050,000
    expect(res.text).toContain('【確認できた事実】');
    expect(
      res.evidence.some((ev) => ev.label === '発生済み原価' && ev.value.includes('800,000'))
    ).toBe(true);
  });

  it('「見積中はいくら？」（パイプライン）が見積タブから答える', async () => {
    const res = await chat('見込み案件はいくら？');
    expect(res.text).toContain('4,800,000円');
  });

  it('「現金大丈夫？」は銀行未接続を明示し推測しない（デモ数値も出さない）', async () => {
    const res = await chat('現金大丈夫？');
    expect(res.confidence).toBe('UNKNOWN');
    expect(res.text).toContain('判断できません');
    for (const num of DEMO_NUMBERS) expect(res.text).not.toContain(num);
  });

  it('「この数字の根拠は？」に直前回答の根拠を返す', async () => {
    await chat('今月の売上どう？');
    const res = await chat('根拠は？');
    expect(res.text).toContain('直前の回答の根拠');
    expect(res.text).toContain('松江市外構工事');
  });

  it('データがない質問はUNKNOWNを返す（AI推測で補わない）', async () => {
    const res = await chat('社員の有給残は？');
    expect(res.confidence).toBe('UNKNOWN');
  });

  it('dataStatusはPARTIAL（会計・銀行等が未接続のため）', async () => {
    const res = await chat('今月の売上どう？');
    expect(res.dataStatus).toBe('PARTIAL');
  });
});
