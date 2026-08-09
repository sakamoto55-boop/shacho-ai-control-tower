/**
 * Canonical意味論テスト（ACCEPTANCE BLOCKER CORRECTION 3 §8）。
 *
 * - 不明を0・既定ステージへ変換しない（UNKNOWN保持）
 * - 未接続Sourceの金額は null + confidence UNKNOWN（0円表示させない）
 * - 未監査status（quote）を営業ステージへ含めない
 * - UI/PPTX/PDF/XLSXが同じ意味（不明=不明）を表示する
 */
import { describe, expect, it } from 'vitest';
import { emptyDataset } from '../../../src/command/sources/SourceAdapter.js';
import type { CommandDataset } from '../../../src/command/data/seed.js';
import type { Project, SourceStatus } from '../../../src/command/domain/types.js';
import { computeSalesSummary } from '../../../src/command/engines/sales.js';
import { checkInvoices } from '../../../src/command/engines/invoiceChecks.js';
import { computeKpiSnapshot } from '../../../src/command/engines/kpi.js';
import { buildAlerts } from '../../../src/command/engines/alerts.js';
import {
  applyTableToDataset,
  parseTimestampCell
} from '../../../src/command/sources/canonicalMapping.js';
import {
  buildManagementDeckSpec,
  buildProjectLedgerWorkbookSpec,
  buildReportDocumentSpec,
  buildSnapshotStamp,
  stageLabel
} from '../../../src/command/artifacts/contentBuilders.js';

const ASOF = '2026-08-09T00:00:00.000Z';

function sourceMeta(name: string, connected: boolean): SourceStatus {
  return {
    sourceName: name,
    sourceType: 'google_sheets',
    lastSuccessfulSync: connected ? ASOF : null,
    freshness: connected ? { lastUpdatedAt: ASOF, source: name, stale: false } : null,
    confidence: connected ? 'HIGH' : 'UNKNOWN',
    readOnly: true,
    scope: 'lcc',
    errorState: connected ? null : 'このSourceは未接続です'
  } as SourceStatus;
}

/** 本番相当: 案件のみ接続・会計/請求/入金未接続・契約額列なし */
function productionLikeDataset(): CommandDataset {
  const dataset = emptyDataset(ASOF, {
    mode: 'production',
    sources: [
      sourceMeta('ProjectSource', true),
      sourceMeta('CustomerSource', true),
      sourceMeta('AccountingSource', false),
      sourceMeta('InvoiceSource', false),
      sourceMeta('PaymentSource', false)
    ]
  });
  dataset.companies = [{ companyId: 'lcc', name: '株式会社LCC' }];
  const base = {
    companyId: 'lcc',
    customerId: 'cust:1',
    stageConfidence: 'PROVISIONAL' as const,
    estimateAmount: null,
    orderAmountSource: 'NONE' as const,
    amountConfidence: 'UNKNOWN' as const,
    plannedMarginRate: null,
    sourceRecordUpdatedAt: null,
    snapshotFetchedAt: ASOF,
    updatedAt: ASOF
  };
  const projects: Project[] = [
    // 受注扱い（contract→ordered暫定）だが契約額不明
    { ...base, projectId: 'prj:1', name: '外構工事X', stage: 'ordered', sourceStatus: 'contract', orderAmount: null, dueDate: '2026-08-20' },
    // 金額確認済の受注
    { ...base, projectId: 'prj:2', name: '解体工事Y', stage: 'ordered', sourceStatus: 'contract', orderAmount: 300_000, amountConfidence: 'HIGH', orderAmountSource: 'CONTRACT', dueDate: '2026-08-25' },
    // 未監査status（quote）→ unknown
    { ...base, projectId: 'prj:3', name: '草刈りZ', stage: 'unknown', sourceStatus: 'quote', orderAmount: null },
    { ...base, projectId: 'prj:4', name: '剪定W', stage: 'unknown', sourceStatus: 'quote', orderAmount: null },
    // 完工済みだが契約額不明（0円へ変換しない）
    { ...base, projectId: 'prj:5', name: '修繕V', stage: 'completed', sourceStatus: 'contract', orderAmount: null, completedDate: '2026-08-05' },
    // 受注扱い・契約額不明（カバレッジを1/3=33.3%へ下げる）
    { ...base, projectId: 'prj:6', name: '舗装U', stage: 'ordered', sourceStatus: 'contract', orderAmount: null, dueDate: '2026-09-10' }
  ];
  dataset.projects = projects;
  return dataset;
}

describe('§8 Canonical意味論: 未接続・不明の非0化', () => {
  const dataset = productionLikeDataset();

  it('会計未接続 → 当月売上KPIは value=null / confidence=UNKNOWN（0円にしない）', () => {
    const kpi = computeKpiSnapshot(dataset, 'lcc', buildAlerts(dataset, 'lcc', []));
    const salesMonth = kpi.kpis.find((k) => k.key === 'sales_month');
    expect(salesMonth?.value).toBeNull();
    expect(salesMonth?.confidence).toBe('UNKNOWN');
  });

  it('Invoice未接続 → 完工未請求は判定不能（value=null / UNKNOWN）', () => {
    const invoices = checkInvoices(dataset, 'lcc');
    expect(invoices.invoicesConnected).toBe(false);
    const kpi = computeKpiSnapshot(dataset, 'lcc', buildAlerts(dataset, 'lcc', []));
    const uninvoiced = kpi.kpis.find((k) => k.key === 'uninvoiced');
    expect(uninvoiced?.value).toBeNull();
    expect(uninvoiced?.confidence).toBe('UNKNOWN');
  });

  it('orderAmount null → 合計へ0円として混ぜず、件数を分離する', () => {
    const sales = computeSalesSummary(dataset, 'lcc');
    expect(sales.orderedCount).toBe(3);
    expect(sales.amountKnownCount).toBe(1);
    expect(sales.amountUnknownCount).toBe(2);
    expect(sales.orderBacklog).toBe(300_000); // 不明分を含まない
    expect(sales.confirmedUnknownAmountCount).toBe(1); // 完工済み・金額不明
    expect(sales.accountingConnected).toBe(false);
  });

  it('quote（未監査status）は営業ステージへ含めず「ステータス未分類」', () => {
    const deck = buildManagementDeckSpec(dataset, 'lcc');
    const pipeline = deck.slides.find((s) => s.title === '営業パイプライン');
    const text = (pipeline?.bullets ?? []).join('\n');
    expect(text).toContain('ステータス未分類 2件');
    expect(text).not.toContain('追客中: 2件'); // quoteを追客中へ変換しない
    expect(stageLabel('unknown')).toContain('UNKNOWN');
  });

  it('source更新列なし → sourceRecordUpdatedAtはUNKNOWN表示（取得時刻で偽装しない）', () => {
    const ledger = buildProjectLedgerWorkbookSpec(dataset, 'lcc');
    const rows = ledger.sheets[0].rows as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.updatedAt === 'UNKNOWN')).toBe(true);
    const stamp = buildSnapshotStamp(dataset, 'lcc');
    expect(stamp.snapshotFetchedAt).not.toBe('未接続'); // 取得時刻は別項目として保持
  });

  it('カバレッジ33.3%（低）→ 受注残KPIはLOW confidence + カバレッジ明記', () => {
    const sales = computeSalesSummary(dataset, 'lcc');
    expect(sales.coverageRate).toBeCloseTo(33.3, 1);
    const kpi = computeKpiSnapshot(dataset, 'lcc', buildAlerts(dataset, 'lcc', []));
    const backlog = kpi.kpis.find((k) => k.key === 'order_backlog');
    expect(backlog?.confidence).toBe('LOW'); // 低カバレッジでHIGHを付けない（1.1%でHIGH禁止）
    expect(backlog?.label).toContain('カバレッジ');
  });

  it('UI・PPTX・PDF・XLSXが同じ意味を表示する（不明=不明、0円にしない）', () => {
    const deck = buildManagementDeckSpec(dataset, 'lcc');
    const deckText = deck.slides.flatMap((s) => s.bullets ?? []).join('\n');
    expect(deckText).toContain('判定不能'); // 確定売上（会計未接続）
    expect(deckText).toContain('受注額：不明'); // 金額不明案件
    expect(deckText).not.toMatch(/確定売上 0円/);

    const report = buildReportDocumentSpec(dataset, 'lcc');
    const reportText = report.sections.flatMap((s) => s.paragraphs).join('\n');
    expect(reportText).toContain('判定不能');
    expect(reportText).toContain('ステータス未分類 2件'); // PPTXと同じ意味をPDFにも表示
    expect(reportText).not.toMatch(/完工未請求 0円/);
    expect(reportText).not.toMatch(/受注額0円/); // 金額不明を0円と書かない（アラート文含む）

    const ledger = buildProjectLedgerWorkbookSpec(dataset, 'lcc');
    const row1 = (ledger.sheets[0].rows as Array<Record<string, unknown>>).find(
      (r) => r.projectId === 'prj:1'
    );
    expect(row1?.orderAmount).toBeNull(); // XLSXは空欄（0を書かない）
  });
});

describe('§8 Canonical変換: 禁止パターンの排除', () => {
  it('未マッピングstatusはunknown/PROVISIONAL、金額空欄はnull、fetchedAtをsource更新と偽らない', () => {
    const dataset = emptyDataset(ASOF, { mode: 'production', sources: [] });
    applyTableToDataset(
      dataset,
      {
        sourceName: 'ProjectSource',
        spreadsheetId: 'x',
        tabName: 'projects',
        companyId: 'lcc',
        columns: {
          projectId: 'id',
          name: 'name',
          stage: 'status',
          estimateAmount: 'estimateTotal',
          sourceUpdatedAt: 'updatedAt',
          ownerName: 'staff'
        },
        stageMap: { contract: 'ordered' }
      },
      {
        spreadsheetId: 'x',
        tabName: 'projects',
        header: ['id', 'name', 'status', 'estimateTotal', 'updatedAt', 'staff'],
        rows: [
          ['P1', '案件A', 'quote', '0', '1782725407000', '藤井信男'],
          ['P2', '案件B', 'contract', '38500', '', ''],
          ['P3', '案件C', '', '', '', '']
        ],
        fetchedAt: ASOF
      }
    );
    const [p1, p2, p3] = dataset.projects;
    // quote → unknown（inquiryへ変換しない）
    expect(p1.stage).toBe('unknown');
    expect(p1.sourceStatus).toBe('quote');
    expect(p1.stageConfidence).toBe('PROVISIONAL');
    // 見積0円=未入力 → null / 契約額列なし → orderAmount=null
    expect(p1.estimateAmount).toBeNull();
    expect(p1.orderAmount).toBeNull();
    expect(p1.amountConfidence).toBe('UNKNOWN');
    // epoch millis → ISO実更新時刻
    expect(p1.sourceRecordUpdatedAt).toBe(new Date(1782725407000).toISOString());
    expect(p1.snapshotFetchedAt).toBe(ASOF);
    expect(p1.ownerName).toBe('藤井信男');
    // マッピング済みcontract → ordered（PROVISIONAL）・見積額は見積額として保持
    expect(p2.stage).toBe('ordered');
    expect(p2.estimateAmount).toBe(38500);
    expect(p2.orderAmount).toBeNull(); // 見積額を受注額へ流用しない
    expect(p2.sourceRecordUpdatedAt).toBeNull(); // 更新列空 → null（fetchedAtで偽装しない）
    // status空 → UNKNOWN
    expect(p3.stage).toBe('unknown');
    expect(p3.stageConfidence).toBe('UNKNOWN');
  });

  it('parseTimestampCell: epoch millis / ISO / 不正値', () => {
    expect(parseTimestampCell('1782725407000')).toBe(new Date(1782725407000).toISOString());
    expect(parseTimestampCell('2026-08-01T00:00:00Z')).toBe('2026-08-01T00:00:00.000Z');
    expect(parseTimestampCell('')).toBeNull();
    expect(parseTimestampCell('abc')).toBeNull();
  });
});
