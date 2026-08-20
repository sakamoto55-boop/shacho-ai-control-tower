/**
 * 資金繰表（Drive上のxlsx）をSA（drive.readonly）でダウンロードし、CashSnapshotを返すソース。
 * - 資格情報はenvのSAのみ（GOOGLE_SERVICE_ACCOUNT_JSON/_FILE）。ファイルはSAへ閲覧者共有が必要。
 * - ファイルIDは env KEIRI_SHIKINGURI_FILE_ID（既定=資金繰表 正本）。
 * - 未設定/未共有/未接続は例外ではなく { available:false, reason } を返す（正直な未接続）。
 */
import {
  DRIVE_READONLY_SCOPE,
  createServiceAccountFromEnv,
  type ServiceAccountTokenProvider
} from './googleSheets.js';
import { snapshotFromBuffer } from './shikinguriExcel.js';
import type { CashSnapshot } from './shikinguri.js';

const DEFAULT_FILE_ID = '1Q7WS1lpbYwXXNxTPJJjd1IkPyqK17ui2'; // ★R8年度(3月～).xlsx（資金繰表 正本）

export type KeiriCashResult =
  | { available: true; snapshot: CashSnapshot; source: 'shikinguri_xlsx'; fileId: string }
  | { available: false; reason: string };

export async function downloadDriveFile(
  fileId: string,
  tokenProvider: ServiceAccountTokenProvider,
  fetchImpl: typeof fetch = fetch
): Promise<Buffer> {
  const token = await tokenProvider.getToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const detail = res.status === 404 ? '（SAへの共有未設定の可能性）' : res.status === 403 ? '（権限不足）' : '';
    throw new Error(`Drive download失敗: HTTP ${res.status}${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function loadKeiriCash(
  asOfIso: string,
  env = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<KeiriCashResult> {
  const fileId = env.KEIRI_SHIKINGURI_FILE_ID || DEFAULT_FILE_ID;
  const provider = createServiceAccountFromEnv(env, { scope: DRIVE_READONLY_SCOPE });
  if (!provider) {
    return { available: false, reason: 'サービスアカウント未設定（GOOGLE_SERVICE_ACCOUNT_FILE）' };
  }
  try {
    const buffer = await downloadDriveFile(fileId, provider, fetchImpl);
    const snapshot = await snapshotFromBuffer(buffer, asOfIso);
    return { available: true, snapshot, source: 'shikinguri_xlsx', fileId };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
