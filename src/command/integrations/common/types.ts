/**
 * 統合連携の共通データ設計（夜間統合運転 §7）。
 * 固定原則: UNKNOWNを0へ変換しない / Source更新時刻と同期時刻を分ける /
 * rawを保持し正規化値から原本へ追跡できる / 推測値は推測と明示する。
 */

export type IntegrationConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type IntegrationFreshness = 'FRESH' | 'STALE' | 'VERY_STALE' | 'UNKNOWN';

export interface IntegrationEvidence {
  /** 原本の場所（ファイルパス・fileId・API URL等。秘密情報は含めない） */
  source: string;
  /** 原本内の位置（シート名・行番号・レコードID等） */
  locator?: string;
  note?: string;
}

/** 全connector共通のレコード封筒 */
export interface IntegrationRecord<TRaw = Record<string, unknown>, TNorm = Record<string, unknown>> {
  sourceSystem: string;
  sourceRecordId: string;
  companyId: string;
  /** Source側レコードの実更新時刻（不明ならnull。取得時刻で代用しない） */
  sourceRecordUpdatedAt: string | null;
  /** LCC COMMAND側が取得した時刻 */
  syncedAt: string;
  rawStatus: string | null;
  normalizedStatus: string | null;
  confidence: IntegrationConfidence;
  freshnessStatus: IntegrationFreshness;
  evidence: IntegrationEvidence[];
  sourceFile: string | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  /** raw内容のsha256（原本追跡・重複排除用） */
  contentHash: string;
  raw: TRaw;
  normalized: TNorm;
}

export interface SyncResult {
  source: string;
  status:
    | 'LIVE_READ_ONLY'
    | 'LOCAL_IMPORT_READY'
    | 'AUTH_REQUIRED'
    | 'ADMIN_SETUP_REQUIRED'
    | 'SOURCE_NOT_FOUND'
    | 'UNSUPPORTED_OFFICIAL_METHOD'
    | 'BLOCKED_TECHNICAL'
    | 'NOT_STARTED'
    // REAL USE 75% SPRINT語彙（実取得成功のみLIVE_API。envの存在だけでは使わない）
    | 'LIVE_API'
    | 'SCHEDULED_EXPORT'
    | 'SHEET_INGESTED'
    | 'MANUAL_IMPORT'
    | 'MOCK_ONLY'
    | 'NOT_CONNECTED'
    | 'ERROR';
  startedAt: string;
  finishedAt: string;
  processed: number;
  imported: number;
  rejected: number;
  duplicates: number;
  errors: string[];
  note?: string;
}

export function freshnessOf(sourceRecordUpdatedAt: string | null, asOf: string): IntegrationFreshness {
  if (!sourceRecordUpdatedAt) return 'UNKNOWN';
  const age = (Date.parse(asOf) - Date.parse(sourceRecordUpdatedAt)) / 86_400_000;
  if (Number.isNaN(age)) return 'UNKNOWN';
  if (age <= 1) return 'FRESH';
  if (age <= 2) return 'STALE';
  return 'VERY_STALE';
}
