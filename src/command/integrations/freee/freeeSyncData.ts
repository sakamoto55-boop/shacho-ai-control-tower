/**
 * freee人事労務 実データ同期（REAL USE GAP AUDIT §4-§5）。
 *
 * - READ ONLY（GETのみ。勤怠・従業員・休暇の更新APIは一切呼ばない）
 * - Raw Vault（JSONL追記専用）へIntegrationRecord封筒で保存。contentHash重複排除（idempotent）
 * - sourceRecordUpdatedAt: freee側のupdated_atがあればそれ、無ければnull（syncedAtで代用しない）
 * - 0件の区別: FETCHED_EMPTY（API実行し0件）/ SCOPE_NOT_GRANTED / ENDPOINT_UNAVAILABLE / NOT_EXECUTED
 * - 給与・賞与のendpointは呼ばない（scope未取得かつポリシー禁止）
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IntegrationRecord } from '../common/types.js';
import { defaultVaultDir } from '../sheets/sheetsVaultSync.js';
import { FreeeClient } from './freeeClient.js';

export type FetchOutcome =
  | 'FETCHED'
  | 'FETCHED_EMPTY'
  | 'SCOPE_NOT_GRANTED'
  | 'ENDPOINT_UNAVAILABLE'
  | 'NOT_EXECUTED'
  | 'ERROR';

export interface FreeeKindResult {
  kind: string;
  endpoint: string;
  outcome: FetchOutcome;
  httpNote?: string;
  fetched: number;
  imported: number;
  duplicates: number;
  period?: string;
}

export interface FreeeSyncSummary {
  companyId: number | null;
  companyName: string | null;
  syncedAt: string;
  kinds: FreeeKindResult[];
  writesToSource: 0;
  errors: string[];
}

function classifyError(message: string): FetchOutcome {
  if (/HTTP 403/.test(message)) return 'SCOPE_NOT_GRANTED';
  if (/HTTP 404/.test(message)) return 'ENDPOINT_UNAVAILABLE';
  return 'ERROR';
}

/**
 * vault追記（IDENTITY設計 v2）。
 * - recordKey = sourceSystem|companyId|sourceRecordId（月次サマリ等はrow.idにemployeeId+対象期間を含める）
 * - payloadHash = canonical化（キー昇順）したraw内容のSHA-256
 * - 同recordKey+同payloadHash=duplicate / 同recordKeyで内容変化=新version（旧はSUPERSEDED扱い・行は保持）
 */
function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function appendRecords(
  vaultDir: string,
  kind: string,
  syncedAt: string,
  rows: { id: string; updatedAt: string | null; raw: Record<string, unknown>; locator: string }[]
): { imported: number; duplicates: number } {
  const rawDir = join(vaultDir, 'raw');
  mkdirSync(rawDir, { recursive: true });
  const vaultFile = join(rawDir, `freee-${kind}.jsonl`);
  const keyFile = join(rawDir, `freee-${kind}.keys.json`);
  const sourceSystem = `freee-hr:${kind}`;
  // keyIndex: recordKey -> payloadHash（初回は既存vault行から再構築＝旧hash方式からの移行）
  const keyIndex: Record<string, string> = existsSync(keyFile)
    ? (JSON.parse(readFileSync(keyFile, 'utf8')) as Record<string, string>)
    : {};
  if (!existsSync(keyFile) && existsSync(vaultFile)) {
    for (const line of readFileSync(vaultFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as IntegrationRecord;
        keyIndex[`${r.sourceSystem}|${r.companyId}|${r.sourceRecordId}`] = createHash('sha256')
          .update(canonicalStringify(r.raw))
          .digest('hex');
      } catch { /* 壊れた行はスキップ */ }
    }
  }
  let imported = 0;
  let duplicates = 0;
  for (const row of rows) {
    const recordKey = `${sourceSystem}|lcc|${row.id}`;
    const payloadHash = createHash('sha256').update(canonicalStringify(row.raw)).digest('hex');
    const known = keyIndex[recordKey];
    if (known === payloadHash) {
      duplicates += 1;
      continue;
    }
    const record: IntegrationRecord = {
      sourceSystem,
      sourceRecordId: row.id,
      companyId: 'lcc',
      sourceRecordUpdatedAt: row.updatedAt,
      syncedAt,
      rawStatus: null,
      normalizedStatus: known ? 'UPDATED_VERSION' : null,
      confidence: 'HIGH',
      freshnessStatus: row.updatedAt ? 'FRESH' : 'UNKNOWN',
      evidence: [{ source: 'freee-hr-api', locator: row.locator }],
      sourceFile: null,
      sourceSheet: null,
      sourceRow: null,
      contentHash: payloadHash,
      raw: row.raw,
      normalized: known ? { supersedesPayloadHash: known } : {}
    };
    appendFileSync(vaultFile, `${JSON.stringify(record)}\n`, 'utf8');
    keyIndex[recordKey] = payloadHash;
    imported += 1;
  }
  writeFileSync(keyFile, JSON.stringify(keyIndex), 'utf8');
  return { imported, duplicates };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 実データ同期本体。maxEmployeesForDetailで従業員別API（打刻・月次サマリ）の対象数を制限
 * （rate limit配慮。全員分は日次バッチで段階拡大する）
 */
export async function syncFreeeData(
  client: FreeeClient,
  options: {
    vaultDir?: string;
    syncedAt?: string;
    maxEmployeesForDetail?: number;
    timeClockDays?: number;
  } = {}
): Promise<FreeeSyncSummary> {
  const vaultDir = options.vaultDir ?? defaultVaultDir();
  const syncedAt = options.syncedAt ?? new Date().toISOString();
  const maxDetail = options.maxEmployeesForDetail ?? 30;
  const days = options.timeClockDays ?? 14;
  const summary: FreeeSyncSummary = {
    companyId: null,
    companyName: null,
    syncedAt,
    kinds: [],
    writesToSource: 0,
    errors: []
  };

  // 事業所
  let companyId: number;
  try {
    const companies = await client.listCompanies();
    if (companies.length === 0) {
      summary.kinds.push({ kind: 'companies', endpoint: '/companies', outcome: 'FETCHED_EMPTY', fetched: 0, imported: 0, duplicates: 0 });
      return summary;
    }
    companyId = companies[0].id;
    summary.companyId = companyId;
    summary.companyName = companies[0].name;
    const r = appendRecords(vaultDir, 'companies', syncedAt, companies.map((c) => ({
      id: String(c.id),
      updatedAt: null,
      raw: c as unknown as Record<string, unknown>,
      locator: `/companies#${c.id}`
    })));
    summary.kinds.push({ kind: 'companies', endpoint: '/companies', outcome: 'FETCHED', fetched: companies.length, ...r });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    summary.errors.push(`companies: ${msg}`);
    summary.kinds.push({ kind: 'companies', endpoint: '/companies', outcome: classifyError(msg), fetched: 0, imported: 0, duplicates: 0 });
    return summary;
  }

  // 一覧系（従業員・部門・役職・所属）
  const listKinds: { kind: string; endpoint: string; extract: (d: Record<string, unknown>) => Record<string, unknown>[] }[] = [
    {
      kind: 'employees',
      endpoint: `/companies/${companyId}/employees?limit=100&with_no_payroll_calculation=true`,
      extract: (d) => (d.employees as Record<string, unknown>[] | undefined) ?? (Array.isArray(d) ? (d as unknown as Record<string, unknown>[]) : [])
    },
    {
      kind: 'groups',
      endpoint: `/groups?company_id=${companyId}`,
      extract: (d) => (Array.isArray(d) ? (d as unknown as Record<string, unknown>[]) : ((d.company_groups ?? d.groups) as Record<string, unknown>[] | undefined) ?? [])
    },
    {
      kind: 'positions',
      endpoint: `/positions?company_id=${companyId}`,
      extract: (d) => (Array.isArray(d) ? (d as unknown as Record<string, unknown>[]) : ((d.company_positions ?? d.positions) as Record<string, unknown>[] | undefined) ?? [])
    },
    {
      kind: 'group-memberships',
      endpoint: `/employee_group_memberships?company_id=${companyId}&base_date=${syncedAt.slice(0,10)}`,
      extract: (d) => (Array.isArray(d) ? (d as unknown as Record<string, unknown>[]) : ((d.employee_group_memberships ?? d.memberships) as Record<string, unknown>[] | undefined) ?? [])
    }
  ];
  const employees: Record<string, unknown>[] = [];
  for (const spec of listKinds) {
    try {
      const data = await client.get<Record<string, unknown>>(spec.endpoint);
      const rows = spec.extract(data);
      if (spec.kind === 'employees') employees.push(...rows);
      const r = appendRecords(vaultDir, spec.kind, syncedAt, rows.map((row, i) => ({
        id: String((row.id as number | string | undefined) ?? `${spec.kind}:${i}`),
        updatedAt: typeof row.updated_at === 'string' ? (row.updated_at as string) : null,
        raw: row,
        locator: `${spec.endpoint}#${(row.id as number | string | undefined) ?? i}`
      })));
      summary.kinds.push({
        kind: spec.kind,
        endpoint: spec.endpoint.replace(String(companyId), '{companyId}'),
        outcome: rows.length === 0 ? 'FETCHED_EMPTY' : 'FETCHED',
        fetched: rows.length,
        ...r
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${spec.kind}: ${msg}`);
      summary.kinds.push({ kind: spec.kind, endpoint: spec.endpoint.replace(String(companyId), '{companyId}'), outcome: classifyError(msg), fetched: 0, imported: 0, duplicates: 0 });
    }
  }

  // 従業員別: 打刻（直近days日）・月次勤務実績サマリ・休暇残
  const to = new Date(syncedAt);
  const from = new Date(to.getTime() - days * 86400_000);
  const period = `${isoDate(from)}〜${isoDate(to)}`;
  const yearMonth = { year: to.getUTCFullYear(), month: to.getUTCMonth() + 1 };
  const detailTargets = employees.slice(0, maxDetail);
  const agg: Record<string, { fetched: number; imported: number; duplicates: number; outcome: FetchOutcome; endpoint: string; period?: string }> = {
    'time-clocks': { fetched: 0, imported: 0, duplicates: 0, outcome: detailTargets.length ? 'FETCHED_EMPTY' : 'NOT_EXECUTED', endpoint: '/employees/{id}/time_clocks?company_id=', period },
    'work-record-summaries': { fetched: 0, imported: 0, duplicates: 0, outcome: detailTargets.length ? 'FETCHED_EMPTY' : 'NOT_EXECUTED', endpoint: '/employees/{id}/work_record_summaries/{y}/{m}?company_id=', period: `${yearMonth.year}-${String(yearMonth.month).padStart(2, '0')}` },
    'holiday-pools': { fetched: 0, imported: 0, duplicates: 0, outcome: detailTargets.length ? 'FETCHED_EMPTY' : 'NOT_EXECUTED', endpoint: '/employees/{id}/holiday_pools?company_id=' }
  };
  for (const emp of detailTargets) {
    const empId = emp.id as number;
    // 打刻
    try {
      const clocks = await client.getTimeClocks(companyId, empId, isoDate(from), isoDate(to));
      agg['time-clocks'].fetched += clocks.length;
      const r = appendRecords(vaultDir, 'time-clocks', syncedAt, clocks.map((c) => ({
        id: `${empId}:${String((c as Record<string, unknown>).id ?? (c as Record<string, unknown>).datetime ?? '')}`,
        updatedAt: typeof (c as Record<string, unknown>).datetime === 'string' ? String((c as Record<string, unknown>).datetime) : null,
        raw: c as Record<string, unknown>,
        locator: `/employees/${empId}/time_clocks`
      })));
      agg['time-clocks'].imported += r.imported;
      agg['time-clocks'].duplicates += r.duplicates;
      if (clocks.length > 0) agg['time-clocks'].outcome = 'FETCHED';
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (agg['time-clocks'].outcome !== 'FETCHED') agg['time-clocks'].outcome = classifyError(msg);
      summary.errors.push(`time-clocks(emp ${empId}): ${msg}`);
    }
    // 月次勤務実績サマリ
    try {
      const wrs = await client.get<Record<string, unknown>>(
        `/employees/${empId}/work_record_summaries/${yearMonth.year}/${yearMonth.month}?company_id=${companyId}`
      );
      agg['work-record-summaries'].fetched += 1;
      const r = appendRecords(vaultDir, 'work-record-summaries', syncedAt, [{
        id: `${empId}:${yearMonth.year}-${yearMonth.month}`,
        updatedAt: null,
        raw: wrs,
        locator: `/employees/${empId}/work_record_summaries/${yearMonth.year}/${yearMonth.month}`
      }]);
      agg['work-record-summaries'].imported += r.imported;
      agg['work-record-summaries'].duplicates += r.duplicates;
      agg['work-record-summaries'].outcome = 'FETCHED';
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (agg['work-record-summaries'].outcome !== 'FETCHED') agg['work-record-summaries'].outcome = classifyError(msg);
      summary.errors.push(`work-record-summaries(emp ${empId}): ${msg}`);
    }
    // 休暇残
    try {
      const pools = await client.get<Record<string, unknown>>(
        `/employees/${empId}/holiday_pools?company_id=${companyId}`
      );
      const rows = ((pools.holiday_pools ?? pools) as Record<string, unknown>[] | Record<string, unknown>);
      const list = Array.isArray(rows) ? rows : [pools];
      agg['holiday-pools'].fetched += list.length;
      const r = appendRecords(vaultDir, 'holiday-pools', syncedAt, list.map((p, i) => ({
        id: `${empId}:${i}`,
        updatedAt: null,
        raw: p as Record<string, unknown>,
        locator: `/employees/${empId}/holiday_pools`
      })));
      agg['holiday-pools'].imported += r.imported;
      agg['holiday-pools'].duplicates += r.duplicates;
      if (list.length > 0) agg['holiday-pools'].outcome = 'FETCHED';
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (agg['holiday-pools'].outcome !== 'FETCHED') agg['holiday-pools'].outcome = classifyError(msg);
      summary.errors.push(`holiday-pools(emp ${empId}): ${msg}`);
    }
  }
  for (const [kind, a] of Object.entries(agg)) {
    summary.kinds.push({ kind, endpoint: a.endpoint, outcome: a.outcome, fetched: a.fetched, imported: a.imported, duplicates: a.duplicates, period: a.period });
  }

  // checkpoint
  const checkpointFile = join(vaultDir, 'raw', 'freee.checkpoint.json');
  writeFileSync(
    checkpointFile,
    JSON.stringify({ lastSyncedAt: syncedAt, companyId, kinds: summary.kinds }, null, 2),
    'utf8'
  );
  return summary;
}
