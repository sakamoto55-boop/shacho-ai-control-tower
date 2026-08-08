/**
 * Google Sheets READ ONLY Source Adapter。
 *
 * - Sheets API v4 の values.get（GET）のみを使用する。書き込み系APIは一切呼ばない。
 * - 元シートへ列追加・書き込み・並べ替えを行わない。
 * - Raw（シート行）→ Canonical Model（CommandDataset）→ Engine の3層を守り、
 *   Orchestratorがセル位置を直接理解する設計にしない。
 * - 各Sourceは schema validation / timeout / retry / freshness / provenance /
 *   scope / errorState を持つ。取得失敗時はデモ値で埋めず errorState を返す。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SourceStatus } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import {
  SOURCE_NAMES,
  emptyDataset,
  type SourceName,
  type SourceRegistry
} from './SourceAdapter.js';
import {
  applyTableToDataset,
  validateTableSchema,
  type SheetSourceConfig
} from './canonicalMapping.js';

/** 取得したシート1タブ分のRawデータ */
export interface SheetTable {
  spreadsheetId: string;
  tabName: string;
  header: string[];
  rows: string[][];
  fetchedAt: string;
}

export interface SheetsClient {
  /** READ ONLY取得。実装はGET系APIのみを使うこと */
  fetchTable(spreadsheetId: string, tabName: string): Promise<SheetTable>;
}

export interface RestSheetsClientOptions {
  /** OAuth / Service Account のアクセストークン（spreadsheets.readonly スコープ推奨） */
  accessToken?: string;
  apiKey?: string;
  timeoutMs?: number;
  retries?: number;
  /** テスト注入用fetch */
  fetchImpl?: typeof fetch;
}

/** Sheets API v4 values.get を叩く実クライアント（READ ONLY） */
export class RestSheetsClient implements SheetsClient {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RestSheetsClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.retries = options.retries ?? 2;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchTable(spreadsheetId: string, tabName: string): Promise<SheetTable> {
    const range = encodeURIComponent(tabName);
    const keyParam = this.options.apiKey ? `?key=${encodeURIComponent(this.options.apiKey)}` : '';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}${keyParam}`;
    const headers: Record<string, string> = {};
    if (this.options.accessToken) headers.authorization = `Bearer ${this.options.accessToken}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: 'GET',
          headers,
          signal: controller.signal
        });
        if (!res.ok) throw new Error(`Sheets API ${res.status}`);
        const body = (await res.json()) as { values?: string[][] };
        const values = body.values ?? [];
        return {
          spreadsheetId,
          tabName,
          header: (values[0] ?? []).map((cell) => String(cell).trim()),
          rows: values.slice(1),
          fetchedAt: new Date().toISOString()
        };
      } catch (error) {
        lastError = error;
        // 指数バックオフ（テスト時間を伸ばさないよう短め）
        if (attempt < this.retries) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`Sheets取得失敗 ${spreadsheetId}/${tabName}: ${String(lastError)}`);
  }
}

/**
 * スナップショットクライアント。
 * 発見フェーズでREAD ONLYエクスポートしたJSON（data/snapshots/、Git管理外）を読む。
 * 実クレデンシャルなしで実データの会話検証を行うための経路で、本番はRestSheetsClientを使う。
 */
export class SnapshotSheetsClient implements SheetsClient {
  constructor(private readonly directory: string) {}

  async fetchTable(spreadsheetId: string, tabName: string): Promise<SheetTable> {
    const path = join(this.directory, `${spreadsheetId}__${tabName}.json`);
    const content = await readFile(path, 'utf8');
    const parsed = JSON.parse(content) as SheetTable;
    if (!Array.isArray(parsed.header) || !Array.isArray(parsed.rows)) {
      throw new Error(`スナップショット形式が不正です: ${path}`);
    }
    return { ...parsed, spreadsheetId, tabName };
  }
}

export interface SheetsRegistryStatic {
  companies: CommandDataset['companies'];
  salesTargets?: CommandDataset['salesTargets'];
}

/**
 * 実データ（Google Sheets）から CommandDataset を構成するRegistry。
 * 設定されていないSource（会計・銀行等）は not_configured のまま明示し、
 * デモデータへは決してフォールバックしない。
 */
export class SheetsSourceRegistry implements SourceRegistry {
  readonly mode = 'production' as const;

  constructor(
    private readonly client: SheetsClient,
    private readonly configs: SheetSourceConfig[],
    private readonly staticData: SheetsRegistryStatic
  ) {}

  async compose(asOf: string): Promise<CommandDataset> {
    const sources: SourceStatus[] = [];
    const dataset = emptyDataset(asOf, { mode: 'production', sources });
    dataset.companies = this.staticData.companies;
    dataset.salesTargets = this.staticData.salesTargets ?? [];

    const configured = new Map(this.configs.map((config) => [config.sourceName, config]));
    for (const sourceName of SOURCE_NAMES) {
      const config = configured.get(sourceName as SourceName);
      if (!config) {
        sources.push({
          sourceName,
          sourceType: 'not_configured',
          lastSuccessfulSync: null,
          freshness: null,
          confidence: 'UNKNOWN',
          readOnly: true,
          scope: 'all',
          errorState: 'UNKNOWN: このSourceは未接続です（正本確定後にPhase B1で設定）'
        });
        continue;
      }
      try {
        const table = await this.client.fetchTable(config.spreadsheetId, config.tabName);
        validateTableSchema(config, table.header);
        applyTableToDataset(dataset, config, table);
        sources.push({
          sourceName,
          sourceType: 'google_sheets',
          lastSuccessfulSync: table.fetchedAt,
          freshness: {
            lastUpdatedAt: table.fetchedAt,
            source: `Google Sheets ${config.spreadsheetId.slice(0, 8)}…/${config.tabName}`,
            stale: false
          },
          confidence: 'HIGH',
          readOnly: true,
          scope: config.companyId,
          errorState: null
        });
      } catch (error) {
        // 部分障害: 該当Sourceのみ errorState、他Sourceは活かす（PARTIAL）
        sources.push({
          sourceName,
          sourceType: 'google_sheets',
          lastSuccessfulSync: null,
          freshness: null,
          confidence: 'UNKNOWN',
          readOnly: true,
          scope: config.companyId,
          errorState: `CONNECTION ERROR: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }
    return dataset;
  }
}

/**
 * 環境変数からSheets Registryを構築する。
 * LCC_SHEETS_SOURCES: SheetSourceConfig[] のJSON
 * LCC_SHEETS_SNAPSHOT_DIR: 指定時はスナップショット読込（クレデンシャル不要）
 * GOOGLE_SHEETS_ACCESS_TOKEN / GOOGLE_SHEETS_API_KEY: RestSheetsClient用
 */
export function createSheetsRegistryFromEnv(env = process.env): SheetsSourceRegistry | null {
  const configsJson = env.LCC_SHEETS_SOURCES;
  if (!configsJson) return null;
  let configs: SheetSourceConfig[];
  let companies: CommandDataset['companies'];
  try {
    configs = JSON.parse(configsJson) as SheetSourceConfig[];
    companies = JSON.parse(env.LCC_COMMAND_COMPANIES ?? '[]') as CommandDataset['companies'];
  } catch {
    return null; // 設定破損時は未接続扱い（デモへはフォールバックしない）
  }
  const client: SheetsClient = env.LCC_SHEETS_SNAPSHOT_DIR
    ? new SnapshotSheetsClient(env.LCC_SHEETS_SNAPSHOT_DIR)
    : new RestSheetsClient({
        accessToken: env.GOOGLE_SHEETS_ACCESS_TOKEN,
        apiKey: env.GOOGLE_SHEETS_API_KEY
      });
  return new SheetsSourceRegistry(client, configs, { companies });
}
