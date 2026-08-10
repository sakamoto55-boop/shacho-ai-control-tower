/**
 * import候補ファイルの検証専用ツール（原本をread-onlyで読み、移動・変更しない）。
 * 使い方: npx tsx scripts/validate-import-file.ts <ファイルパス>
 * 結果: 形式判定・行数・マッピング成功率・sha256 を表示し、
 *       logs/integrations/validate-YYYYMMDD.jsonl へ処理証跡を残す（顧客名等の中身は出さない）。
 */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { decodeBuffer, parseCsv } from '../src/command/integrations/common/importInbox.js';
import { TKC_DEFINITIONS } from '../src/command/integrations/tkc/tkcImport.js';

const target = process.argv[2];
if (!target) {
  console.error('usage: npx tsx scripts/validate-import-file.ts <file>');
  process.exit(1);
}

const buf = readFileSync(target);
const sha256 = createHash('sha256').update(buf).digest('hex');
const { text, encoding } = decodeBuffer(buf);
const rows = parseCsv(text);
const header = rows[0]?.map((h) => h.trim()) ?? [];
const def = TKC_DEFINITIONS.find((d) => d.requiredHeaders.every((k) => header.some((h) => h.includes(k))));

let mapped = 0;
let rejected = 0;
if (def) {
  const sample = Math.min(rows.length, 501);
  for (let i = 1; i < sample; i++) {
    const rec = def.mapRow(header, rows[i], { sourceFile: basename(target), rowIndex: i + 1, syncedAt: new Date().toISOString() });
    if (rec) mapped += 1;
    else rejected += 1;
  }
}

const result = {
  at: new Date().toISOString(),
  file: basename(target),
  sha256,
  encoding,
  dataRows: rows.length - 1,
  headerColumns: header.length,
  matchedDefinition: def?.name ?? null,
  sampleMapped: mapped,
  sampleRejected: rejected,
  readOnly: true
};
mkdirSync('logs/integrations', { recursive: true });
appendFileSync(
  join('logs/integrations', `validate-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.jsonl`),
  `${JSON.stringify(result)}\n`,
  'utf8'
);
console.log(JSON.stringify(result, null, 2));
