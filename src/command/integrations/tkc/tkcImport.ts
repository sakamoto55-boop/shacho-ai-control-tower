/**
 * TKC会計 正式export（CSV/XLSX）のimport定義（夜間統合運転 §12）。
 * 公式APIは未確認のため、人が出力した正式ファイルを data/import/tkc/inbox で受ける。
 * 仕訳・試算表・元帳をヘッダーで分類し、金額はUNKNOWNを0にしない。
 * 書き戻し・仕訳登録・締処理は行わない（read-only）。
 */
import { createHash } from 'node:crypto';
import type { ImportDefinition, ProcessOptions } from '../common/importInbox.js';
import { processInbox } from '../common/importInbox.js';
import type { IntegrationRecord } from '../common/types.js';
import { freshnessOf } from '../common/types.js';

const COMPANY_ID = 'lcc';

function parseAmount(value: string): number | null {
  const t = value.replace(/[,\s円¥]/g, '');
  if (t === '' || t === '-') return null; // 空欄は0にしない
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function baseRecord(
  kind: string,
  header: string[],
  row: string[],
  ctx: { sourceFile: string; rowIndex: number; syncedAt: string },
  sourceRecordUpdatedAt: string | null
): IntegrationRecord {
  const raw: Record<string, string> = {};
  header.forEach((h, i) => {
    raw[h || `col${i}`] = row[i] ?? '';
  });
  // 重複排除はファイル名に依存せず内容で行う（同一内容の再投入をduplicateとして検出するため）
  const contentHash = createHash('sha256').update(`${kind}|${JSON.stringify(raw)}`).digest('hex');
  return {
    sourceSystem: 'tkc',
    sourceRecordId: `tkc-${kind}-${contentHash.slice(0, 16)}`,
    companyId: COMPANY_ID,
    sourceRecordUpdatedAt,
    syncedAt: ctx.syncedAt,
    rawStatus: null,
    normalizedStatus: kind,
    confidence: 'HIGH',
    freshnessStatus: freshnessOf(sourceRecordUpdatedAt, ctx.syncedAt),
    evidence: [{ source: `data/import/tkc/processed/${ctx.sourceFile}`, locator: `row ${ctx.rowIndex}` }],
    sourceFile: ctx.sourceFile,
    sourceSheet: null,
    sourceRow: ctx.rowIndex,
    contentHash,
    raw,
    normalized: {}
  };
}

function pick(header: string[], row: string[], keys: string[]): string {
  for (const key of keys) {
    const idx = header.findIndex((h) => h.includes(key));
    if (idx >= 0) return (row[idx] ?? '').trim();
  }
  return '';
}

/** 仕訳データ（伝票日付・借方/貸方科目・金額） */
export const tkcShiwakeDefinition: ImportDefinition = {
  name: 'tkc-shiwake',
  requiredHeaders: ['日付', '借方', '貸方'],
  mapRow: (header, row, ctx) => {
    const date = pick(header, row, ['伝票日付', '日付']);
    if (!date) return null;
    const rec = baseRecord('shiwake', header, row, ctx, null);
    rec.normalized = {
      date,
      debitAccount: pick(header, row, ['借方科目', '借方勘定科目', '借方']),
      creditAccount: pick(header, row, ['貸方科目', '貸方勘定科目', '貸方']),
      amount: parseAmount(pick(header, row, ['金額', '借方金額'])),
      description: pick(header, row, ['摘要'])
    };
    return rec;
  }
};

/** 月次試算表（勘定科目・残高） */
export const tkcTrialBalanceDefinition: ImportDefinition = {
  name: 'tkc-trial-balance',
  requiredHeaders: ['勘定科目', '残高'],
  mapRow: (header, row, ctx) => {
    const account = pick(header, row, ['勘定科目']);
    if (!account) return null;
    const rec = baseRecord('trial-balance', header, row, ctx, null);
    rec.normalized = {
      account,
      openingBalance: parseAmount(pick(header, row, ['繰越残高', '前月残高'])),
      debit: parseAmount(pick(header, row, ['借方'])),
      credit: parseAmount(pick(header, row, ['貸方'])),
      closingBalance: parseAmount(pick(header, row, ['残高', '当月残高']))
    };
    return rec;
  }
};

/** 総勘定元帳・補助元帳 */
export const tkcLedgerDefinition: ImportDefinition = {
  name: 'tkc-ledger',
  requiredHeaders: ['科目', '摘要', '残高'],
  mapRow: (header, row, ctx) => {
    const date = pick(header, row, ['日付', '伝票日付']);
    const description = pick(header, row, ['摘要']);
    if (!date && !description) return null;
    const rec = baseRecord('ledger', header, row, ctx, null);
    rec.normalized = {
      date: date || null,
      account: pick(header, row, ['科目', '勘定科目']),
      description,
      debit: parseAmount(pick(header, row, ['借方'])),
      credit: parseAmount(pick(header, row, ['貸方'])),
      balance: parseAmount(pick(header, row, ['残高']))
    };
    return rec;
  }
};

export const TKC_DEFINITIONS = [tkcShiwakeDefinition, tkcTrialBalanceDefinition, tkcLedgerDefinition];

export async function syncTkcInbox(baseDir: string, syncedAt: string, knownHashes?: Set<string>) {
  const options: ProcessOptions = {
    baseDir,
    source: 'tkc',
    definitions: TKC_DEFINITIONS,
    syncedAt,
    knownHashes
  };
  return processInbox(options);
}
