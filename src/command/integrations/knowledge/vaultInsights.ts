/**
 * Vault実データの決定論インサイトエンジン（REAL USE 75% SPRINT）。
 *
 * - 対象: %LOCALAPPDATA%\LCC_COMMAND\vault\raw の実同期データ（Sheets SA READ ONLY取込分）。
 * - 数値の集計・判定はすべて決定論（AIに計算させない）。未入力は0と区別して「未入力」と返す。
 * - 日報は「日報データ」タブのみ集計（backupタブ日報データ_bk*は二重計上になるため除外）。
 * - 入金はソースに列が存在しない（payments_json全行空）ため、推測せずNOT_AVAILABLEを返す。
 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultVaultDir } from '../sheets/sheetsVaultSync.js';

export interface VaultRow {
  sourceSystem: string;
  sourceRecordId: string;
  sourceSheet: string | null;
  sourceRow: number | null;
  syncedAt: string;
  evidence: Array<{ source: string; locator: string; note?: string }>;
  raw: Record<string, string>;
  normalized?: { extractionCandidates?: string[] };
}

const cache = new Map<string, { mtimeMs: number; rows: VaultRow[] }>();

export function loadVault(key: string, vaultDir = defaultVaultDir()): VaultRow[] {
  // 同期writerは vault/raw/<key>.jsonl へ書く（sheetsVaultSync.ts）
  const file = join(vaultDir, 'raw', `${key}.jsonl`);
  if (!existsSync(file)) return [];
  const mtimeMs = statSync(file).mtimeMs;
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.rows;
  const rows: VaultRow[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as VaultRow);
    } catch {
      // 壊れた行はスキップ（欠損として扱い、偽データで補わない）
    }
  }
  cache.set(file, { mtimeMs, rows });
  return rows;
}

/** "1,234" "¥500" 等を数値へ。空・非数値はnull（0と区別する） */
function parseNum(value: string | undefined): number | null {
  if (value === undefined) return null;
  const cleaned = value.replace(/[¥￥,、\s円]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 金額欄: "0"や空は未入力扱い（このシートでは0=未入力運用のため） */
function amountOrNull(value: string | undefined): number | null {
  const n = parseNum(value);
  return n === null || n === 0 ? null : n;
}

function latestSyncedAt(rows: VaultRow[]): string | null {
  let latest: string | null = null;
  for (const r of rows) if (!latest || r.syncedAt > latest) latest = r.syncedAt;
  return latest;
}

/* ============================================================
 * 1) 今日の配置・欠員・日報（daily_ops）
 * ============================================================ */
export interface DailyOpsResult {
  generatedAt: string;
  /** 集計対象日（日報にその日の行が無ければ直近の日付へフォールバックし、その旨を明示） */
  targetDate: string | null;
  requestedDate: string;
  usedFallbackDate: boolean;
  dataBasis: { source: string; syncedAt: string | null; totalReportRows: number };
  sites: Array<{ site: string; kubun: string; kosu: number | null; worker: boolean; vehicle: string; row: number | null }>;
  kosuTotal: number;
  kubunBreakdown: Record<string, number>;
  unconfirmedCount: number;
  confirmedCount: number;
  /** 欠員・配置予定: 構造化された配置予定ソースが未接続のため判定不能（推測しない） */
  assignments: { state: 'NOT_CONNECTED'; reason: string };
  evidence: Array<{ source: string; locator: string; note?: string }>;
  notes: string[];
}

export function dailyOps(requestedDate: string, vaultDir = defaultVaultDir()): DailyOpsResult {
  const all = loadVault('daily-report-ai', vaultDir);
  // backupタブ（日報データ_bk*）は二重計上になるため除外。正本タブのみ
  const reports = all.filter((r) => r.sourceSheet === '日報データ');
  const dates = [...new Set(reports.map((r) => r.raw['日付']).filter(Boolean))].sort();
  let targetDate: string | null = requestedDate;
  let usedFallbackDate = false;
  if (!reports.some((r) => r.raw['日付'] === requestedDate)) {
    targetDate = dates.length ? dates[dates.length - 1] : null;
    usedFallbackDate = targetDate !== null;
  }
  const rows = targetDate ? reports.filter((r) => r.raw['日付'] === targetDate) : [];
  const kubunBreakdown: Record<string, number> = {};
  let kosuTotal = 0;
  let unconfirmedCount = 0;
  let confirmedCount = 0;
  const sites: DailyOpsResult['sites'] = [];
  for (const r of rows) {
    const kubun = r.raw['区分'] || '（区分なし）';
    kubunBreakdown[kubun] = (kubunBreakdown[kubun] ?? 0) + 1;
    const kosu = parseNum(r.raw['工数']);
    if (kosu !== null) kosuTotal += kosu;
    if ((r.raw['確定（✔で転記対象）'] ?? '') !== '') confirmedCount += 1;
    else unconfirmedCount += 1;
    sites.push({
      site: r.raw['現場'] || '（現場名なし）',
      kubun,
      kosu,
      worker: Boolean(r.raw['作業員']),
      vehicle: r.raw['車両'] || '',
      row: r.sourceRow
    });
  }
  const notes: string[] = [];
  if (usedFallbackDate) notes.push(`指定日（${requestedDate}）の日報行がないため、直近の${targetDate}分を表示`);
  notes.push('日報は写真AI読取のドラフトで、確定チェック済み行のみが実績候補（現状の確定済みは' + `${confirmedCount}件）`);
  return {
    generatedAt: new Date().toISOString(),
    targetDate,
    requestedDate,
    usedFallbackDate,
    dataBasis: { source: 'sheets:daily-report-ai（日報データタブ・backupタブ除外）', syncedAt: latestSyncedAt(reports), totalReportRows: reports.length },
    sites,
    kosuTotal,
    kubunBreakdown,
    unconfirmedCount,
    confirmedCount,
    assignments: {
      state: 'NOT_CONNECTED',
      reason: '配置予定（配置板シート）は日付ピボット形式で構造化取込が未接続のため、欠員は判定できません'
    },
    evidence: rows.slice(0, 5).flatMap((r) => r.evidence),
    notes
  };
}

/* ============================================================
 * 2) 案件の財務カード（project_finance）
 * ============================================================ */
export interface ProjectFinanceCard {
  generatedAt: string;
  matched: Array<{
    projectId: string;
    name: string;
    customerName: string;
    type: string;
    status: string;
    orderDate: string | null;
    workStart: string | null;
    workEnd: string | null;
    staff: string;
    /** null = シート上0または空 = 未入力（0円と断定しない） */
    estimateTotal: number | null;
    estimateAmount: number | null;
    cost: number | null;
    grossProfit: number | null;
    grossProfitRate: number | null;
    invoiceTotal: number | null;
    billingStatus: string;
    /** payments_jsonは全行空のため常にNOT_AVAILABLE（入金は推測しない） */
    payments: { state: 'NOT_AVAILABLE'; reason: string };
    legalDocs: { total: number; byType: Record<string, number>; byState: Record<string, number> } | null;
    evidence: Array<{ source: string; locator: string; note?: string }>;
  }>;
  candidatesShown: number;
  totalMatched: number;
  dataBasis: { source: string; syncedAt: string | null };
  driveMaterials: { state: string; reason: string };
  notes: string[];
}

function normalizeName(s: string): string {
  // U+3000=全角スペース（案件名の全角空白対策）
  return s.replace(/[\s\u3000]/g, '').toLowerCase();
}

export function projectFinance(query: string, vaultDir = defaultVaultDir()): ProjectFinanceCard {
  const db = loadVault('lcc-integrated-db', vaultDir);
  const projects = db.filter((r) => r.sourceSheet === 'projects');
  const caseDb = loadVault('lcc-case-db', vaultDir);
  const docs = caseDb.filter((r) => r.sourceSheet === '05_documents');
  const q = normalizeName(query);
  const hits = q.length >= 2
    ? projects.filter((r) => normalizeName(r.raw['name'] ?? '').includes(q) || normalizeName(r.raw['customerName'] ?? '').includes(q))
    : [];
  const shown = hits.slice(0, 3);
  const cards = shown.map((r) => {
    const projectId = r.raw['id'] ?? r.sourceRecordId;
    const related = docs.filter((d) => d.raw['project_id'] === projectId);
    const byType: Record<string, number> = {};
    const byState: Record<string, number> = {};
    for (const d of related) {
      byType[d.raw['doc_type'] || '不明'] = (byType[d.raw['doc_type'] || '不明'] ?? 0) + 1;
      byState[d.raw['doc_state'] || '不明'] = (byState[d.raw['doc_state'] || '不明'] ?? 0) + 1;
    }
    return {
      projectId,
      name: r.raw['name'] ?? '',
      customerName: r.raw['customerName'] ?? '',
      type: r.raw['type'] ?? '',
      status: r.raw['status'] ?? '',
      orderDate: r.raw['orderDate'] || null,
      workStart: r.raw['workStart'] || null,
      workEnd: r.raw['workEnd'] || null,
      staff: r.raw['staff'] ?? '',
      estimateTotal: amountOrNull(r.raw['estimateTotal']),
      estimateAmount: amountOrNull(r.raw['estimateAmount']),
      cost: amountOrNull(r.raw['cost']),
      grossProfit: amountOrNull(r.raw['grossProfit']),
      grossProfitRate: parseNum(r.raw['grossProfitRate']) || null,
      invoiceTotal: amountOrNull(r.raw['invoiceTotal']),
      billingStatus: r.raw['billingStatus'] ?? '',
      payments: {
        state: 'NOT_AVAILABLE' as const,
        reason: '入金列がソースに存在しない（payments_jsonは全行空）。入金状況は会計・銀行接続後に表示'
      },
      legalDocs: related.length ? { total: related.length, byType, byState } : null,
      evidence: r.evidence.concat(related.slice(0, 2).flatMap((d) => d.evidence))
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    matched: cards,
    candidatesShown: shown.length,
    totalMatched: hits.length,
    dataBasis: { source: 'sheets:lcc-integrated-db（projectsタブ）+ sheets:lcc-case-db（05_documents）', syncedAt: latestSyncedAt(projects) },
    driveMaterials: { state: 'ERROR', reason: 'Drive APIがGCPプロジェクトで未有効化のため関連資料検索は未接続（有効化後にnpm run sync:driveで接続）' },
    notes: [
      '金額欄が「未入力」の場合、シート上が0または空であることを意味し、0円と断定しません',
      '受注額の専用列はソースに存在しないため、見積税込（estimateTotal）を代表金額として表示しています'
    ]
  };
}

/* ============================================================
 * 3) 要対応リスト（action_items）
 * ============================================================ */
const CANDIDATE_PRIORITY: Record<string, number> = {
  '事故・危険': 1,
  '期限': 2,
  '依頼': 3,
  '要確認': 4,
  '案件': 5,
  '決定': 6,
  '報告': 7
};

export interface ActionItemsResult {
  generatedAt: string;
  items: Array<{
    priority: number;
    category: string;
    title: string;
    detail: string;
    receivedAt: string | null;
    source: string;
    evidence: Array<{ source: string; locator: string; note?: string }>;
  }>;
  dataBasis: Array<{ source: string; syncedAt: string | null; scanned: number }>;
  notes: string[];
}

export function actionItems(vaultDir = defaultVaultDir()): ActionItemsResult {
  const items: ActionItemsResult['items'] = [];
  const lineworks = loadVault('lineworks-inbox', vaultDir);
  for (const r of lineworks) {
    const candidates = r.normalized?.extractionCandidates ?? [];
    if (!candidates.length) continue;
    const best = candidates
      .map((c) => c.split(':')[0])
      .reduce((a, b) => ((CANDIDATE_PRIORITY[a] ?? 9) <= (CANDIDATE_PRIORITY[b] ?? 9) ? a : b));
    const pri = CANDIDATE_PRIORITY[best] ?? 9;
    if (pri > 4) continue; // 報告・相槌系は要対応に含めない
    items.push({
      priority: pri,
      category: best,
      title: `LINE WORKS受信: ${best}`,
      detail: (r.raw['本文'] ?? '').replace(/\n/g, ' ').slice(0, 80),
      receivedAt: r.raw['受信日時'] || null,
      source: 'LINE WORKS受信箱（SHEET_INGESTED・本体API接続ではない）',
      evidence: r.evidence
    });
  }
  const caseDb = loadVault('lcc-case-db', vaultDir);
  const docs = caseDb.filter((r) => r.sourceSheet === '05_documents');
  const needCheck = docs.filter((r) => r.raw['doc_state'] === '要確認');
  if (needCheck.length) {
    const byType: Record<string, number> = {};
    for (const d of needCheck) byType[d.raw['doc_type'] || '不明'] = (byType[d.raw['doc_type'] || '不明'] ?? 0) + 1;
    items.push({
      priority: 3,
      category: '法定書類',
      title: `法定書類 ${needCheck.length}件が「要確認」`,
      detail: Object.entries(byType).map(([t, n]) => `${t}:${n}件`).join(' / ') + '（期日・提出日が全行未入力のため期限判定は不能）',
      receivedAt: null,
      source: '法定書類管理（lcc-case-db・DERIVED）',
      evidence: needCheck.slice(0, 3).flatMap((r) => r.evidence)
    });
  }
  const reports = loadVault('daily-report-ai', vaultDir).filter((r) => r.sourceSheet === '日報データ');
  const unconfirmed = reports.filter((r) => (r.raw['確定（✔で転記対象）'] ?? '') === '').length;
  if (unconfirmed > 0) {
    items.push({
      priority: 4,
      category: '日報確認',
      title: `未確定の日報ドラフトが${unconfirmed}件`,
      detail: '写真AI読取の日報が確定チェック待ち。確定分のみが実績原価の入力候補になります',
      receivedAt: null,
      source: '日報データ（AI読み取り・SHEET_INGESTED）',
      evidence: reports.slice(0, 2).flatMap((r) => r.evidence)
    });
  }
  items.sort((a, b) => a.priority - b.priority || (b.receivedAt ?? '').localeCompare(a.receivedAt ?? ''));
  return {
    generatedAt: new Date().toISOString(),
    items: items.slice(0, 12),
    dataBasis: [
      { source: 'lineworks-inbox', syncedAt: latestSyncedAt(lineworks), scanned: lineworks.length },
      { source: 'lcc-case-db', syncedAt: latestSyncedAt(caseDb), scanned: caseDb.length },
      { source: 'daily-report-ai', syncedAt: latestSyncedAt(reports), scanned: reports.length }
    ],
    notes: [
      '優先度は決定論ルール（事故・危険>期限>依頼・法定書類>要確認・日報）で並べています。AIの推測は含みません',
      '銀行・会計・受発注の期日データは未接続のため、資金・入金起因の要対応は本リストに含まれていません'
    ]
  };
}
