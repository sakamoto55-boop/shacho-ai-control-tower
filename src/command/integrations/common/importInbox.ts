/**
 * 汎用 import inbox（夜間統合運転 §12・§15）。
 * data/import/<source>/inbox に置かれた正式export（CSV/XLSX）を
 * 検出→形式判定→検証→正規化→processed/rejected へ移動する。
 * 原本は変更しない（inbox内のファイルは利用者が置いたコピー）。read-only原則。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, appendFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { IntegrationRecord, SyncResult } from './types.js';
import { freshnessOf } from './types.js';

export interface ImportDefinition {
  /** 定義名（例: tkc-shiwake） */
  name: string;
  /** ヘッダー行にこのキーワード群が全て含まれれば該当形式とみなす */
  requiredHeaders: string[];
  /** 行→レコード正規化。nullを返すと不正行としてreject理由に計上 */
  mapRow: (
    header: string[],
    row: string[],
    ctx: { sourceFile: string; rowIndex: number; syncedAt: string }
  ) => IntegrationRecord | null;
}

export interface InboxPaths {
  inbox: string;
  processed: string;
  rejected: string;
  normalizedDir: string;
  logFile: string;
}

export function inboxPaths(baseDir: string, source: string): InboxPaths {
  return {
    inbox: join(baseDir, 'import', source, 'inbox'),
    processed: join(baseDir, 'import', source, 'processed'),
    rejected: join(baseDir, 'import', source, 'rejected'),
    normalizedDir: join(baseDir, 'normalized', source),
    logFile: join(baseDir, 'import', source, 'import-log.jsonl')
  };
}

export function ensureInbox(paths: InboxPaths): void {
  for (const dir of [paths.inbox, paths.processed, paths.rejected, paths.normalizedDir]) {
    mkdirSync(dir, { recursive: true });
  }
}

/** 文字コード判定（BOM→UTF-8既定→SJIS判定は簡易ヒューリスティック） */
export function decodeBuffer(buf: Buffer): { text: string; encoding: string } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8-bom' };
  }
  const utf8 = buf.toString('utf8');
  // U+FFFD（置換文字）が出たらUTF-8ではない → CP932として解釈
  if (!utf8.includes('�')) return { text: utf8, encoding: 'utf-8' };
  try {
    const sjis = new TextDecoder('shift-jis', { fatal: false }).decode(buf);
    return { text: sjis, encoding: 'shift_jis' };
  } catch {
    return { text: utf8, encoding: 'utf-8(lossy)' };
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuote = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      cur.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cur.push(field);
      field = '';
      if (cur.some((c) => c !== '')) rows.push(cur);
      cur = [];
    } else {
      field += ch;
    }
  }
  cur.push(field);
  if (cur.some((c) => c !== '')) rows.push(cur);
  return rows;
}

async function readTable(filePath: string): Promise<{ rows: string[][]; encoding: string }> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    const { text, encoding } = decodeBuffer(readFileSync(filePath));
    const normalized = lower.endsWith('.tsv') ? text.replace(/\t/g, ',') : text;
    return { rows: parseCsv(normalized), encoding };
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    const rows: string[][] = [];
    ws.eachRow((row) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        values.push(cell.value === null || cell.value === undefined ? '' : String(cell.text ?? cell.value));
      });
      rows.push(values);
    });
    return { rows, encoding: 'xlsx' };
  }
  throw new Error(`unsupported file type: ${basename(filePath)}`);
}

export interface ProcessOptions {
  baseDir: string;
  source: string;
  definitions: ImportDefinition[];
  syncedAt: string;
  /** 既知contentHash（重複排除。呼び出し側が normalized 済みから収集） */
  knownHashes?: Set<string>;
}

/** inbox内の全ファイルを処理する。原本hash・処理証跡をimport-log.jsonlへ残す */
export async function processInbox(options: ProcessOptions): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const paths = inboxPaths(options.baseDir, options.source);
  ensureInbox(paths);
  const known = options.knownHashes ?? new Set<string>();
  const result: SyncResult = {
    source: options.source,
    status: 'LOCAL_IMPORT_READY',
    startedAt,
    finishedAt: startedAt,
    processed: 0,
    imported: 0,
    rejected: 0,
    duplicates: 0,
    errors: []
  };

  const files = existsSync(paths.inbox) ? readdirSync(paths.inbox).filter((f) => !f.startsWith('.')) : [];
  for (const file of files) {
    const filePath = join(paths.inbox, file);
    const fileBuf = readFileSync(filePath);
    const fileHash = createHash('sha256').update(fileBuf).digest('hex');
    result.processed += 1;
    const logEntry: Record<string, unknown> = {
      at: new Date().toISOString(),
      file,
      fileSha256: fileHash
    };
    try {
      const { rows, encoding } = await readTable(filePath);
      if (rows.length < 2) throw new Error('データ行がありません');
      const header = rows[0].map((h) => h.trim());
      const def = options.definitions.find((d) => d.requiredHeaders.every((k) => header.some((h) => h.includes(k))));
      if (!def) throw new Error(`形式を判定できません（ヘッダー: ${header.slice(0, 8).join(',')}…）`);
      const records: IntegrationRecord[] = [];
      let rejectedRows = 0;
      for (let i = 1; i < rows.length; i++) {
        const rec = def.mapRow(header, rows[i], { sourceFile: file, rowIndex: i + 1, syncedAt: options.syncedAt });
        if (rec === null) {
          rejectedRows += 1;
          continue;
        }
        if (known.has(rec.contentHash)) {
          result.duplicates += 1;
          continue;
        }
        known.add(rec.contentHash);
        records.push(rec);
      }
      const outName = `${def.name}_${fileHash.slice(0, 12)}.json`;
      const outPath = join(paths.normalizedDir, outName);
      const payload = {
        importedAt: options.syncedAt,
        definition: def.name,
        sourceFile: file,
        sourceFileSha256: fileHash,
        encoding,
        rowCount: rows.length - 1,
        rejectedRows,
        records
      };
      const { writeFileSync } = await import('node:fs');
      writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      renameSync(filePath, join(paths.processed, file));
      result.imported += records.length;
      Object.assign(logEntry, { status: 'processed', definition: def.name, imported: records.length, rejectedRows, normalized: outName });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      renameSync(filePath, join(paths.rejected, file));
      result.rejected += 1;
      result.errors.push(`${file}: ${reason}`);
      Object.assign(logEntry, { status: 'rejected', reason });
    }
    appendFileSync(paths.logFile, `${JSON.stringify(logEntry)}\n`, 'utf8');
  }
  result.finishedAt = new Date().toISOString();
  return result;
}

export { freshnessOf };
