/**
 * 「会社の動き」：Drive上の最近更新ファイル（SAへ共有された範囲）を業務シグナルへ分類するフィード。
 * - 内容は解析しない（メタ情報のみ）。ファイル名・種別から業務種別を推定し、可能なら人数を軽く抽出。
 * - SAは「共有されたファイル」しか見えない。未共有の業務フォルダは出ない（正直な範囲）。
 * - 資格情報はenvのSA（drive.readonly）。個人情報は扱わない（ファイル名のみ）。
 */
import {
  DRIVE_READONLY_SCOPE,
  createServiceAccountFromEnv,
  type ServiceAccountTokenProvider
} from './googleSheets.js';

export interface ActivityItem {
  id: string;
  name: string;
  modifiedTime: string;
  /** 業務シグナル（現場日報/見積/契約/施工/資金/連絡/産廃/請求/書類/その他） */
  signal: string;
  /** ファイル名から拾えた人数（現場日報など）。無ければnull */
  headcount: number | null;
}

export type CompanyActivityResult =
  | { available: true; items: ActivityItem[]; note: string }
  | { available: false; reason: string };

/** ファイル名・mimeTypeから業務シグナルを推定（内容は読まない） */
export function classifyActivity(name: string, mimeType: string): { signal: string; headcount: number | null } {
  const n = name || '';
  const headMatch = /(\d+)\s*名/.exec(n);
  const headcount = headMatch ? Number(headMatch[1]) : null;
  let signal = 'その他';
  if (/資金繰|資金|入金|支払|未払|前渡|売掛|繰越|経費/.test(n)) signal = '資金';
  else if (/作業日報|日報/.test(n)) signal = '現場日報';
  else if (/見積/.test(n)) signal = '見積';
  else if (/契約|協定|約款/.test(n)) signal = '契約';
  else if (/施工|着工|請負施工/.test(n)) signal = '施工';
  else if (/マニフェスト/.test(n)) signal = '産廃';
  else if (/請求/.test(n)) signal = '請求';
  else if (/LINEWORKS|受信箱|連絡/.test(n)) signal = '連絡';
  else if (/名簿|社員|作業員/.test(n)) signal = '人員';
  else if (mimeType === 'application/vnd.google-apps.folder') signal = 'フォルダ';
  return { signal, headcount };
}

export async function listRecentDriveFiles(
  tokenProvider: ServiceAccountTokenProvider,
  sinceIso: string,
  fetchImpl: typeof fetch = fetch
): Promise<Array<{ id: string; name: string; mimeType: string; modifiedTime: string }>> {
  const token = await tokenProvider.getToken();
  const q = `trashed=false and modifiedTime > '${sinceIso}'`;
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&orderBy=modifiedTime desc&pageSize=50&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime)')}` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive list失敗: HTTP ${res.status}`);
  const body = (await res.json()) as { files?: Array<{ id: string; name: string; mimeType: string; modifiedTime: string }> };
  return body.files ?? [];
}

export async function loadCompanyActivity(
  sinceIso: string,
  env = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<CompanyActivityResult> {
  const provider = createServiceAccountFromEnv(env, { scope: DRIVE_READONLY_SCOPE });
  if (!provider) return { available: false, reason: 'サービスアカウント未設定（GOOGLE_SERVICE_ACCOUNT_FILE）' };
  try {
    const files = await listRecentDriveFiles(provider, sinceIso, fetchImpl);
    // 既知の資金繰表ファイルIDは名前に「資金」が無くても「資金」に確定させる
    const keiriId = env.KEIRI_SHIKINGURI_FILE_ID || '1Q7WS1lpbYwXXNxTPJJjd1IkPyqK17ui2';
    const items: ActivityItem[] = files
      .filter((f) => f.mimeType !== 'application/vnd.google-apps.folder')
      .map((f) => {
        const { signal, headcount } = classifyActivity(f.name, f.mimeType);
        return { id: f.id, name: f.name, modifiedTime: f.modifiedTime, signal: f.id === keiriId ? '資金' : signal, headcount };
      });
    return {
      available: true,
      items,
      note: 'アプリのサービスアカウントに共有されたファイルのみ表示しています。業務フォルダ（見積・施工・契約など）をSAへ共有すると、ここに自動で増えます。'
    };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
