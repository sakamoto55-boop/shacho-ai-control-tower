/**
 * Source Adapter層。
 *
 * Canonical Model（CommandDataset）とデータ取得元を分離する。
 * 本番接続では「全データを巨大なDatasetとして一括取得」せず、
 * ドメイン別のSource Adapterが必要な範囲を取得し、composeDatasetが正規化ビューへ束ねる。
 *
 * 現時点の接続前提（Gate Review §1で確定した方針）:
 * - Google Workspace中心。Google Sheets + GAS を主要な構造化データ基盤とする。
 * - 配置・日報は運用中のデジタル配置板系、見積・原価は現行の統合業務システムを利用。
 * - LINE WORKS / Form は入力チャネル。会計・給与は実運用を確認してから接続（UNKNOWN）。
 * - 正本を増やさない。既存IDは externalIds（Mapping Layer）で統合し振り直さない。
 */
import type { DataConfidence, DatasetMeta, Freshness, SourceStatus } from '../domain/types.js';
import { buildSeedDataset, type CommandDataset } from '../data/seed.js';

/** ドメイン別Source名。spec §2の一覧に対応する。 */
export const SOURCE_NAMES = [
  'CashSource',
  'AccountingSource',
  'ProjectSource',
  'EstimateSource',
  'CostSource',
  'InvoiceSource',
  'PaymentSource',
  'DailyReportSource',
  'ScheduleSource',
  'CustomerSource',
  'InteractionSource',
  'DocumentSource'
] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];

export interface SourceFetchResult {
  status: 'ok' | 'unavailable' | 'error';
  freshness: Freshness | null;
  confidence: DataConfidence;
  errorState: string | null;
}

/**
 * Source Registry。各Sourceの取得と状態を担う。
 * Phase Bでは source ごとに GoogleSheetsAdapter / GasAdapter / InternalApiAdapter を実装して
 * ここへ差し込む。エンジン・Orchestratorは一切変更しない。
 */
export interface SourceRegistry {
  mode: 'demo' | 'production';
  /** 正規化ビューを構成する。取得不能なSourceは空配列＋errorStateで返す（デモ値で埋めない）。 */
  compose(asOf: string): Promise<CommandDataset>;
}

function demoSourceStatus(name: SourceName, asOf: string): SourceStatus {
  // 配置板・会計・文書はPhase Aのデモにも未実装（UNKNOWNのまま確定しない）
  const notModeled: SourceName[] = [
    'AccountingSource',
    'DailyReportSource',
    'ScheduleSource',
    'DocumentSource'
  ];
  if (notModeled.includes(name)) {
    return {
      sourceName: name,
      sourceType: 'not_configured',
      lastSuccessfulSync: null,
      freshness: null,
      confidence: 'UNKNOWN',
      readOnly: true,
      scope: 'all',
      errorState: 'UNKNOWN: 実運用の確認後にPhase Bで接続方式を確定する'
    };
  }
  return {
    sourceName: name,
    sourceType: 'demo_fixture',
    lastSuccessfulSync: asOf,
    freshness: { lastUpdatedAt: asOf, source: 'Demo Fixture', stale: false },
    confidence: 'HIGH',
    readOnly: true,
    scope: 'all',
    errorState: null
  };
}

export function buildDemoMeta(asOf: string): DatasetMeta {
  return { mode: 'demo', sources: SOURCE_NAMES.map((name) => demoSourceStatus(name, asOf)) };
}

/** Demo Fixture（seed）から構成するRegistry。demoモード専用。 */
export class DemoSourceRegistry implements SourceRegistry {
  readonly mode = 'demo' as const;

  async compose(asOf: string): Promise<CommandDataset> {
    return buildSeedDataset(asOf);
  }
}

export function emptyDataset(asOf: string, meta: DatasetMeta): CommandDataset {
  return {
    asOf,
    meta,
    companies: [],
    customers: [],
    employees: [],
    vendors: [],
    projects: [],
    estimates: [],
    interactions: [],
    costs: [],
    invoices: [],
    payments: [],
    cashAccounts: [],
    cashPlans: [],
    salesTargets: []
  };
}

/**
 * 本番Registry。実Adapterが未設定のSourceは「接続エラー/未設定」を明示し、
 * デモデータへは決してフォールバックしない（Demo Fixture完全隔離）。
 */
export class ProductionSourceRegistry implements SourceRegistry {
  readonly mode = 'production' as const;

  async compose(asOf: string): Promise<CommandDataset> {
    const sources: SourceStatus[] = SOURCE_NAMES.map((name) => ({
      sourceName: name,
      sourceType: 'not_configured',
      lastSuccessfulSync: null,
      freshness: null,
      confidence: 'UNKNOWN',
      readOnly: true,
      scope: 'all',
      errorState: 'CONNECTION ERROR: 実データソースが未接続です（Phase Bで接続）'
    }));
    return emptyDataset(asOf, { mode: 'production', sources });
  }
}

/** データセットが数値回答に使える状態か（本番未接続・全ソース欠損の検知） */
export function datasetAvailability(
  dataset: CommandDataset
): 'OK' | 'PARTIAL' | 'DATA_UNAVAILABLE' {
  const usable = dataset.meta.sources.filter((s) => s.errorState === null);
  if (usable.length === 0) return 'DATA_UNAVAILABLE';
  if (usable.length < dataset.meta.sources.length) return 'PARTIAL';
  return 'OK';
}
