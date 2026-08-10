/**
 * Sheets → Raw Vault 取込（TRACK B: INTEGRATION & MEMORY INGESTION V1）。
 *
 * 固定原則:
 * - READ ONLY（Sheets API GETのみ。Sourceへの書き込みAPIを一切呼ばない）
 * - Raw Vaultは追記専用JSONL。contentHash（sha256）で重複排除（idempotent）
 * - sourceRecordUpdatedAt（Source実更新）とsyncedAt（取得時刻）を分離。不明はnull（取得時刻で代用しない）
 * - raw IDを振り直さない。UNKNOWNを0へ変えない
 * - 保存先は既定で %LOCALAPPDATA%\LCC_COMMAND\vault（Git外・OneDrive外）
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import type { SheetsClient } from '../../sources/googleSheets.js';
import type { IntegrationRecord, SyncResult } from '../common/types.js';

export interface SheetVaultSource {
  /** vault内のキー（ファイル名・レポート表示に使用） */
  key: string;
  spreadsheetId: string;
  /** 取込対象タブ。省略時はメタデータから全タブを列挙（最大maxTabs） */
  tabs?: string[];
  classification:
    | 'CURRENT_SOURCE'
    | 'CURRENT_SOURCE_CANDIDATE'
    | 'CURRENT_EVIDENCE_SOURCE'
    | 'DERIVED_SOURCE'
    | 'HISTORICAL_SOURCE';
  note?: string;
}

/** 優先1のSheets Source正本一覧（TRACK B §Source of Truth） */
export const SHEET_VAULT_SOURCES: SheetVaultSource[] = [
  {
    key: 'lcc-integrated-db',
    spreadsheetId: '1jOU-Kq8vh7Meaa7auNQqVflseRAPCcGzksAsvG-16HY',
    classification: 'CURRENT_SOURCE',
    note: '顧客・案件正本（カンバンボード）'
  },
  {
    key: 'daily-report-ai',
    spreadsheetId: '19nu2KzprKgf5NOLxsgh-TXaau0zkjisx3d19Eia5MZ8',
    classification: 'CURRENT_SOURCE_CANDIDATE',
    note: '日報ドラフト・写真AI読取。確定チェック済み行のみ実績候補、未確認行はDRAFT'
  },
  {
    key: 'lineworks-inbox',
    spreadsheetId: '1T-aLFFNzOGEIgnT6xsHcB5SxrVNJFYWZZi1Och7NidM',
    tabs: ['lineworks_inbox'],
    classification: 'CURRENT_EVIDENCE_SOURCE',
    note: 'LINE WORKS受信箱（段階1取込）'
  },
  {
    key: 'lcc-case-db',
    spreadsheetId: '1fU-QEnWnfE6AwWIV2wuiK1pERY5HbGPJ0GTMC0hPaJs',
    classification: 'DERIVED_SOURCE',
    note: '法定書類管理のみ。案件正本として重複取込しない'
  }
];

export function defaultVaultDir(env = process.env): string {
  if (env.LCC_INTEGRATION_VAULT_DIR) return env.LCC_INTEGRATION_VAULT_DIR;
  const base = env.LOCALAPPDATA ?? './data';
  return join(base, 'LCC_COMMAND', 'vault');
}

/** タブ一覧の取得（GETのみ）。tabs指定があればそれを使う */
export async function listTabs(
  spreadsheetId: string,
  tokenProvider: { getToken(): Promise<string> },
  fetchImpl: typeof fetch = fetch,
  maxTabs = 20
): Promise<string[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${await tokenProvider.getToken()}` }
  });
  if (!res.ok) throw new Error(`Sheets metadata API ${res.status}`);
  const body = (await res.json()) as { sheets?: { properties?: { title?: string } }[] };
  return (body.sheets ?? [])
    .map((s) => s.properties?.title ?? '')
    .filter((t) => t.length > 0)
    .slice(0, maxTabs);
}

/** LINE WORKS受信箱の抽出候補（決定論キーワード。候補扱いでEvidenceは原文行） */
export function extractLineworksCandidates(text: string): string[] {
  const rules: [string, RegExp][] = [
    ['案件', /案件|現場|工事/],
    ['依頼', /依頼|お願い|手配|見積/],
    ['期限', /期限|まで(に|には)|締切|〆切/],
    ['事故・危険', /事故|危険|ケガ|怪我|ヒヤリ|クレーム/],
    ['報告', /報告|完了|終わりました/],
    ['決定', /決定|確定|承認/],
    ['要確認', /確認|どうします|判断/]
  ];
  return rules.filter(([, re]) => re.test(text)).map(([label]) => label);
}

interface VaultCheckpoint {
  key: string;
  lastSyncedAt: string | null;
  totalRecords: number;
  tabs: Record<string, { rows: number; lastSyncedAt: string }>;
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** 1つのSheets SourceをRaw Vaultへ取込む（追記専用・重複排除・checkpoint付き） */
export async function syncSheetSourceToVault(
  source: SheetVaultSource,
  client: SheetsClient,
  options: {
    vaultDir: string;
    syncedAt: string;
    tokenProvider?: { getToken(): Promise<string> };
    fetchImpl?: typeof fetch;
  }
): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const rawDir = join(options.vaultDir, 'raw');
  mkdirSync(rawDir, { recursive: true });
  const vaultFile = join(rawDir, `${source.key}.jsonl`);
  const hashFile = join(rawDir, `${source.key}.hashes.json`);
  const checkpointFile = join(rawDir, `${source.key}.checkpoint.json`);
  const seen = new Set<string>(loadJson<string[]>(hashFile, []));
  const checkpoint = loadJson<VaultCheckpoint>(checkpointFile, {
    key: source.key,
    lastSyncedAt: null,
    totalRecords: seen.size,
    tabs: {}
  });

  const errors: string[] = [];
  let processed = 0;
  let imported = 0;
  let duplicates = 0;

  let tabs = source.tabs;
  if (!tabs) {
    if (!options.tokenProvider) {
      return {
        source: `sheets:${source.key}`,
        status: 'ADMIN_SETUP_REQUIRED',
        startedAt,
        finishedAt: new Date().toISOString(),
        processed: 0,
        imported: 0,
        rejected: 0,
        duplicates: 0,
        errors: ['Service Account未設定のためタブ一覧を取得できません'],
        note: source.note
      };
    }
    try {
      tabs = await listTabs(source.spreadsheetId, options.tokenProvider, options.fetchImpl);
    } catch (error) {
      return {
        source: `sheets:${source.key}`,
        status: 'BLOCKED_TECHNICAL',
        startedAt,
        finishedAt: new Date().toISOString(),
        processed: 0,
        imported: 0,
        rejected: 0,
        duplicates: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        note: `${source.note ?? ''}（SAへの閲覧共有が未実施の可能性）`
      };
    }
  }

  for (const tab of tabs) {
    let table;
    try {
      table = await client.fetchTable(source.spreadsheetId, tab);
    } catch (error) {
      errors.push(`${tab}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    let tabRows = 0;
    table.rows.forEach((row, index) => {
      if (row.every((cell) => String(cell ?? '').trim() === '')) return;
      processed += 1;
      const rawObject: Record<string, unknown> = {};
      table.header.forEach((h, i) => {
        if (h) rawObject[h] = row[i] ?? '';
      });
      const contentHash = createHash('sha256')
        .update(JSON.stringify({ tab, raw: rawObject }))
        .digest('hex');
      if (seen.has(contentHash)) {
        duplicates += 1;
        return;
      }
      // raw IDは振り直さない: ID列（ID/id/メッセージID等）があればそれを使い、無ければ位置ベース
      const idColumn = table.header.find((h) => /(^|[^a-z])id$|^ID$|ID$|管理番号|メッセージID/i.test(h));
      const sourceRecordId = idColumn && String(rawObject[idColumn] ?? '').trim() !== ''
        ? String(rawObject[idColumn])
        : `${tab}:row${index + 2}`;
      const bodyText = Object.values(rawObject).map((v) => String(v ?? '')).join(' ');
      const record: IntegrationRecord = {
        sourceSystem: `sheets:${source.key}`,
        sourceRecordId,
        companyId: 'lcc',
        sourceRecordUpdatedAt: null, // Source側の実更新時刻列が確定するまでnull（取得時刻で代用しない）
        syncedAt: options.syncedAt,
        rawStatus: null,
        normalizedStatus: null,
        confidence: 'HIGH',
        freshnessStatus: 'UNKNOWN',
        evidence: [
          {
            source: `spreadsheet:${source.spreadsheetId}`,
            locator: `${tab}!row${index + 2}`,
            note: source.classification
          }
        ],
        sourceFile: null,
        sourceSheet: tab,
        sourceRow: index + 2,
        contentHash,
        raw: rawObject,
        normalized:
          source.key === 'lineworks-inbox'
            ? { extractionCandidates: extractLineworksCandidates(bodyText) }
            : {}
      };
      appendFileSync(vaultFile, `${JSON.stringify(record)}\n`, 'utf8');
      seen.add(contentHash);
      imported += 1;
      tabRows += 1;
    });
    checkpoint.tabs[tab] = {
      rows: (checkpoint.tabs[tab]?.rows ?? 0) + tabRows,
      lastSyncedAt: options.syncedAt
    };
  }

  checkpoint.lastSyncedAt = options.syncedAt;
  checkpoint.totalRecords = seen.size;
  writeFileSync(hashFile, JSON.stringify([...seen]), 'utf8');
  writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8');

  return {
    source: `sheets:${source.key}`,
    status: errors.length > 0 && imported === 0 && duplicates === 0 ? 'BLOCKED_TECHNICAL' : 'LIVE_READ_ONLY',
    startedAt,
    finishedAt: new Date().toISOString(),
    processed,
    imported,
    rejected: 0,
    duplicates,
    errors,
    note: source.note
  };
}
