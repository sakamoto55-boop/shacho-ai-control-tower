/**
 * Raw（シート行）→ Canonical Model 変換層。
 *
 * - 列名は日本語のまま columns マッピングで対応する（元シートの構造を変更しない）。
 * - 既存IDは変更せず、canonical IDは `<prefix>:<既存ID>` 形式で外部IDを保持する
 *   （Crosswalk。新しい全社IDを勝手に振り直さない）。
 * - スキーマ検証: 必須列がヘッダに無ければ ValidationError としてSourceを
 *   errorState にする（黙って空データにしない）。
 */
import type {
  CostCategory,
  DailyReportEntry,
  ProjectStage,
  ScheduleAssignment
} from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import type { SourceName } from './SourceAdapter.js';
import type { SheetTable } from './googleSheets.js';

export interface SheetSourceConfig {
  sourceName: SourceName;
  spreadsheetId: string;
  tabName: string;
  companyId: string;
  /** canonicalフィールド名 → シート列名 */
  columns: Record<string, string>;
  /** 任意: ステータス文字列 → ProjectStage の追加マッピング */
  stageMap?: Record<string, ProjectStage>;
}

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

/** 各Sourceで必須のcanonicalフィールド */
const REQUIRED_FIELDS: Partial<Record<SourceName, string[]>> = {
  ProjectSource: ['projectId', 'name'],
  CustomerSource: ['customerId', 'name'],
  EstimateSource: ['estimateId', 'projectId', 'amount'],
  CostSource: ['projectId', 'amount'],
  InvoiceSource: ['invoiceId', 'projectId', 'amount'],
  PaymentSource: ['paymentId', 'amount', 'date'],
  ScheduleSource: ['date', 'siteName', 'employeeName'],
  DailyReportSource: ['date', 'siteName', 'employeeName'],
  InteractionSource: ['customerId', 'datetime', 'summary']
};

export function validateTableSchema(config: SheetSourceConfig, header: string[]): void {
  const required = REQUIRED_FIELDS[config.sourceName] ?? [];
  const missing: string[] = [];
  for (const field of required) {
    const column = config.columns[field];
    if (!column) missing.push(`${field}(マッピング未定義)`);
    else if (!header.includes(column)) missing.push(`${field}→「${column}」列がシートにない`);
  }
  if (missing.length > 0) {
    throw new SchemaValidationError(
      `schema validation失敗 [${config.sourceName}]: ${missing.join(', ')}`
    );
  }
}

/** 「¥1,234,567円」「1,234」等を数値へ。空・非数値は null */
export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = String(raw)
    .replace(/[¥￥,、\s円]/g, '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** 「2026/8/8」「2026-08-08」「8月8日」等を YYYY-MM-DD へ。解釈不能は null */
export function parseDateCell(raw: string | undefined, baseYear?: number): string | null {
  if (!raw) return null;
  const text = String(raw)
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  const slash = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (slash) return `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`;
  const jp = text.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
  if (jp) {
    const year = jp[1] ?? String(baseYear ?? new Date().getUTCFullYear());
    return `${year}-${jp[2].padStart(2, '0')}-${jp[3].padStart(2, '0')}`;
  }
  return null;
}

const DEFAULT_STAGE_MAP: Record<string, ProjectStage> = {
  問い合わせ: 'inquiry',
  問合せ: 'inquiry',
  現調: 'survey',
  現地調査: 'survey',
  見積中: 'estimating',
  見積作成中: 'estimating',
  見積提出: 'following',
  追客: 'following',
  追客中: 'following',
  商談中: 'following',
  受注: 'ordered',
  契約: 'ordered',
  施工中: 'in_progress',
  着工: 'in_progress',
  工事中: 'in_progress',
  完工: 'completed',
  完了: 'completed',
  請求済: 'invoiced',
  請求済み: 'invoiced',
  入金済: 'paid',
  入金済み: 'paid',
  失注: 'lost',
  キャンセル: 'lost'
};

export function parseStage(
  raw: string | undefined,
  extra?: Record<string, ProjectStage>
): ProjectStage | null {
  if (!raw) return null;
  const text = String(raw).trim();
  return extra?.[text] ?? DEFAULT_STAGE_MAP[text] ?? null;
}

const COST_CATEGORY_MAP: Record<string, CostCategory> = {
  人工: 'labor',
  人件費: 'labor',
  労務: 'labor',
  外注: 'subcontract',
  外注費: 'subcontract',
  処分: 'disposal',
  処分費: 'disposal',
  産廃: 'disposal',
  材料: 'material',
  材料費: 'material',
  車両: 'vehicle',
  車両費: 'vehicle',
  重機: 'machine',
  重機費: 'machine',
  運搬: 'transport',
  運搬費: 'transport'
};

function cell(
  table: SheetTable,
  row: string[],
  config: SheetSourceConfig,
  field: string
): string | undefined {
  const column = config.columns[field];
  if (!column) return undefined;
  const index = table.header.indexOf(column);
  if (index < 0) return undefined;
  const value = row[index];
  return value === undefined || value === '' ? undefined : String(value).trim();
}

/**
 * テーブルをCanonical Modelへ変換してdatasetに追記する。
 * 既存IDは `externalIds.sheet` に原文のまま保持する（振り直さない）。
 */
export function applyTableToDataset(
  dataset: CommandDataset,
  config: SheetSourceConfig,
  table: SheetTable
): void {
  const c = (row: string[], field: string) => cell(table, row, config, field);
  const companyId = config.companyId;

  if (config.sourceName === 'CustomerSource') {
    for (const row of table.rows) {
      const rawId = c(row, 'customerId');
      const name = c(row, 'name');
      if (!rawId || !name) continue;
      dataset.customers.push({
        customerId: `cust:${rawId}`,
        companyId,
        name,
        phone: c(row, 'phone'),
        email: c(row, 'email'),
        externalIds: { sheet: rawId }
      });
    }
  } else if (config.sourceName === 'ProjectSource') {
    for (const row of table.rows) {
      const rawId = c(row, 'projectId');
      const name = c(row, 'name');
      if (!rawId || !name) continue;
      const stage = parseStage(c(row, 'stage'), config.stageMap);
      dataset.projects.push({
        projectId: `prj:${rawId}`,
        companyId,
        customerId: c(row, 'customerId') ? `cust:${c(row, 'customerId')}` : '',
        name,
        stage: stage ?? 'inquiry',
        orderAmount: parseAmount(c(row, 'orderAmount')) ?? 0,
        plannedMarginRate: (parseAmount(c(row, 'plannedMarginPercent')) ?? 0) / 100,
        startDate: parseDateCell(c(row, 'startDate')) ?? undefined,
        dueDate: parseDateCell(c(row, 'dueDate')) ?? undefined,
        completedDate: parseDateCell(c(row, 'completedDate')) ?? undefined,
        updatedAt: table.fetchedAt,
        externalIds: { sheet: rawId }
      });
    }
  } else if (config.sourceName === 'EstimateSource') {
    for (const row of table.rows) {
      const rawId = c(row, 'estimateId');
      const projectId = c(row, 'projectId');
      const amount = parseAmount(c(row, 'amount'));
      if (!rawId || !projectId || amount === null) continue;
      dataset.estimates.push({
        estimateId: `est:${rawId}`,
        companyId,
        projectId: `prj:${projectId}`,
        amount,
        submittedAt: parseDateCell(c(row, 'submittedAt')) ?? undefined,
        probability:
          parseAmount(c(row, 'probabilityPercent')) !== null
            ? (parseAmount(c(row, 'probabilityPercent')) as number) / 100
            : undefined,
        status: c(row, 'ordered') === '受注' ? 'ordered' : 'submitted'
      });
    }
  } else if (config.sourceName === 'CostSource') {
    let seq = 0;
    for (const row of table.rows) {
      const projectId = c(row, 'projectId');
      const amount = parseAmount(c(row, 'amount'));
      if (!projectId || amount === null) continue;
      const category = COST_CATEGORY_MAP[c(row, 'category') ?? ''] ?? 'other';
      dataset.costs.push({
        costId: c(row, 'costId') ? `cost:${c(row, 'costId')}` : `cost:${config.tabName}:${seq++}`,
        companyId,
        projectId: `prj:${projectId}`,
        category,
        amount,
        date: parseDateCell(c(row, 'date')) ?? table.fetchedAt.slice(0, 10),
        kind: c(row, 'kind') === '予定' ? 'planned' : 'actual'
      });
    }
  } else if (config.sourceName === 'InvoiceSource') {
    for (const row of table.rows) {
      const rawId = c(row, 'invoiceId');
      const projectId = c(row, 'projectId');
      const amount = parseAmount(c(row, 'amount'));
      if (!rawId || !projectId || amount === null) continue;
      const paidAt = parseDateCell(c(row, 'paidAt'));
      dataset.invoices.push({
        invoiceId: `inv:${rawId}`,
        companyId,
        projectId: `prj:${projectId}`,
        customerId: c(row, 'customerId') ? `cust:${c(row, 'customerId')}` : '',
        amount,
        issuedAt: parseDateCell(c(row, 'issuedAt')) ?? undefined,
        dueDate: parseDateCell(c(row, 'dueDate')) ?? undefined,
        paidAt: paidAt ?? undefined,
        status: paidAt ? 'paid' : 'issued',
        externalIds: { sheet: rawId }
      });
    }
  } else if (config.sourceName === 'PaymentSource') {
    for (const row of table.rows) {
      const rawId = c(row, 'paymentId');
      const amount = parseAmount(c(row, 'amount'));
      const date = parseDateCell(c(row, 'date'));
      if (!rawId || amount === null || !date) continue;
      dataset.payments.push({
        paymentId: `pay:${rawId}`,
        companyId,
        invoiceId: c(row, 'invoiceId') ? `inv:${c(row, 'invoiceId')}` : undefined,
        amount,
        date,
        direction: c(row, 'direction') === '出金' ? 'out' : 'in'
      });
    }
  } else if (config.sourceName === 'ScheduleSource') {
    // 予定配置。実績（日報）とは別物として保持し、人工計算には使わない
    let seq = 0;
    for (const row of table.rows) {
      const date = parseDateCell(c(row, 'date'));
      const siteName = c(row, 'siteName');
      const employeeName = c(row, 'employeeName');
      if (!date || !siteName || !employeeName) continue;
      const assignment: ScheduleAssignment = {
        assignmentId: `asg:${config.tabName}:${seq++}`,
        companyId,
        date,
        projectId: c(row, 'projectId') ? `prj:${c(row, 'projectId')}` : undefined,
        siteName,
        employeeId: c(row, 'employeeId') ? `emp:${c(row, 'employeeId')}` : undefined,
        employeeName,
        vehicle: c(row, 'vehicle'),
        note: c(row, 'note')
      };
      dataset.assignments.push(assignment);
    }
  } else if (config.sourceName === 'DailyReportSource') {
    let seq = 0;
    for (const row of table.rows) {
      const date = parseDateCell(c(row, 'date'));
      const siteName = c(row, 'siteName');
      const employeeName = c(row, 'employeeName');
      if (!date || !siteName || !employeeName) continue;
      const report: DailyReportEntry = {
        reportId: `dr:${config.tabName}:${seq++}`,
        companyId,
        date,
        projectId: c(row, 'projectId') ? `prj:${c(row, 'projectId')}` : undefined,
        siteName,
        employeeId: c(row, 'employeeId') ? `emp:${c(row, 'employeeId')}` : undefined,
        employeeName,
        manDays: parseAmount(c(row, 'manDays')) ?? 1,
        workDescription: c(row, 'workDescription'),
        subcontractorName: c(row, 'subcontractorName')
      };
      dataset.dailyReports.push(report);
    }
  } else if (config.sourceName === 'InteractionSource') {
    let seq = 0;
    for (const row of table.rows) {
      const customerId = c(row, 'customerId');
      const datetime = parseDateCell(c(row, 'datetime'));
      const summary = c(row, 'summary');
      if (!customerId || !datetime || !summary) continue;
      dataset.interactions.push({
        interactionId: `int:${config.tabName}:${seq++}`,
        companyId,
        customerId: `cust:${customerId}`,
        projectId: c(row, 'projectId') ? `prj:${c(row, 'projectId')}` : undefined,
        channel: 'manual',
        datetime: `${datetime}T00:00:00.000Z`,
        summary
      });
    }
  }
}
