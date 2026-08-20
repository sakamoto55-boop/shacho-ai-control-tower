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
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
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
  /** 本番標準: Service Accountからトークンを動的取得する（accessToken/apiKeyより優先） */
  tokenProvider?: { getToken(): Promise<string> };
  timeoutMs?: number;
  retries?: number;
  /** テスト注入用fetch */
  fetchImpl?: typeof fetch;
}

/**
 * Service Account認証（Phase B1.5 §1 本番標準）。
 *
 * - スコープは spreadsheets.readonly 固定（READ ONLY強制）。
 * - 対象Spreadsheetのみ閲覧者共有する最小権限方式を前提とし、広域Drive権限は要求しない。
 * - 資格情報は環境変数（GOOGLE_SERVICE_ACCOUNT_JSON / _FILE）からのみ読み込み、
 *   コード・Git・ログ・フロントエンドへ露出しない。
 */
export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export class ServiceAccountTokenProvider {
  private cachedToken: string | null = null;
  private cachedUntilMs = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;

  private readonly scope: string;

  constructor(
    private readonly credentials: ServiceAccountCredentials,
    options: { fetchImpl?: typeof fetch; nowMs?: () => number; scope?: string } = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nowMs = options.nowMs ?? Date.now;
    this.scope = options.scope ?? SHEETS_READONLY_SCOPE;
  }

  /** RS256署名のJWT（scopeは生成時指定・既定 spreadsheets.readonly）を作る */
  buildAssertion(nowSec: number): string {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: this.credentials.client_email,
        scope: this.scope,
        aud: this.credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
        iat: nowSec,
        exp: nowSec + 3600
      })
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const signature = signer.sign(this.credentials.private_key).toString('base64url');
    return `${header}.${claims}.${signature}`;
  }

  async getToken(): Promise<string> {
    if (this.cachedToken && this.nowMs() < this.cachedUntilMs) return this.cachedToken;
    const nowSec = Math.floor(this.nowMs() / 1000);
    const assertion = this.buildAssertion(nowSec);
    const tokenUri = this.credentials.token_uri ?? 'https://oauth2.googleapis.com/token';
    const res = await this.fetchImpl(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }).toString()
    });
    if (!res.ok) throw new Error(`Service Accountトークン取得失敗: ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Service Accountトークン取得失敗: access_tokenなし');
    this.cachedToken = body.access_token;
    // 期限60秒前まで再利用
    this.cachedUntilMs = this.nowMs() + ((body.expires_in ?? 3600) - 60) * 1000;
    return this.cachedToken;
  }
}

/** GOOGLE_SERVICE_ACCOUNT_JSON（インラインJSON）/ _FILE（パス）から資格情報を読む */
export function createServiceAccountFromEnv(
  env = process.env,
  options: { scope?: string } = {}
): ServiceAccountTokenProvider | null {
  let raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw && env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    try {
      raw = readFileSync(env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8');
    } catch {
      return null;
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccountCredentials;
    if (!parsed.client_email || !parsed.private_key) return null;
    return new ServiceAccountTokenProvider(parsed, { scope: options.scope });
  } catch {
    return null;
  }
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
    const useKey = this.options.apiKey && !this.options.tokenProvider && !this.options.accessToken;
    const keyParam = useKey ? `?key=${encodeURIComponent(this.options.apiKey as string)}` : '';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}${keyParam}`;
    const headers: Record<string, string> = {};
    if (this.options.tokenProvider) {
      headers.authorization = `Bearer ${await this.options.tokenProvider.getToken()}`;
    } else if (this.options.accessToken) {
      headers.authorization = `Bearer ${this.options.accessToken}`;
    }

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
        // 本番標準はService Account（spreadsheets.readonly・最小権限共有）。
        // API Keyは非公開業務シートの本番認証としては使わない（開発検証のみ）。
        tokenProvider: createServiceAccountFromEnv(env) ?? undefined,
        accessToken: env.GOOGLE_SHEETS_ACCESS_TOKEN,
        apiKey: env.GOOGLE_SHEETS_API_KEY
      });
  return new SheetsSourceRegistry(client, configs, { companies });
}
