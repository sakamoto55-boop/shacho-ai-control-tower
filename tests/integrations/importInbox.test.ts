import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncTkcInbox } from '../../src/command/integrations/tkc/tkcImport.js';
import { decodeBuffer, parseCsv } from '../../src/command/integrations/common/importInbox.js';

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'lcc-inbox-'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const SHIWAKE_CSV = [
  '伝票日付,借方科目,貸方科目,金額,摘要',
  '2026/07/01,外注費,買掛金,100000,山崎組 6月分',
  '2026/07/02,燃料費,現金,"12,000",軽油',
  ',,,,'
].join('\r\n');

describe('TKC import inbox', () => {
  it('仕訳CSVを検出して正規化しprocessedへ移動する', async () => {
    const inbox = join(base, 'import', 'tkc', 'inbox');
    await mkdir(inbox, { recursive: true });
    await writeFile(join(inbox, 'shiwake_202607.csv'), `\uFEFF${SHIWAKE_CSV}`, 'utf8');

    const result = await syncTkcInbox(base, '2026-08-10T01:00:00.000Z');
    expect(result.imported).toBe(2);
    expect(result.rejected).toBe(0);
    expect((await readdir(join(base, 'import', 'tkc', 'processed'))).length).toBe(1);

    const normalizedFiles = await readdir(join(base, 'normalized', 'tkc'));
    expect(normalizedFiles.length).toBe(1);
    const payload = JSON.parse(await readFile(join(base, 'normalized', 'tkc', normalizedFiles[0]), 'utf8'));
    expect(payload.records[0].sourceSystem).toBe('tkc');
    expect(payload.records[0].normalized.amount).toBe(100000);
    expect(payload.records[1].normalized.amount).toBe(12000);
    // Source更新時刻は不明のままnull（取得時刻で代用しない）
    expect(payload.records[0].sourceRecordUpdatedAt).toBeNull();
    expect(payload.records[0].syncedAt).toBe('2026-08-10T01:00:00.000Z');
    // 原本追跡（Evidence・行番号・contentHash）
    expect(payload.records[0].evidence[0].locator).toBe('row 2');
    expect(payload.records[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同一内容は重複排除される', async () => {
    const inbox = join(base, 'import', 'tkc', 'inbox');
    await mkdir(inbox, { recursive: true });
    await writeFile(join(inbox, 'a.csv'), SHIWAKE_CSV, 'utf8');
    const first = await syncTkcInbox(base, '2026-08-10T01:00:00.000Z');
    expect(first.imported).toBe(2);

    const known = new Set<string>();
    const normalizedFiles = await readdir(join(base, 'normalized', 'tkc'));
    for (const f of normalizedFiles) {
      const payload = JSON.parse(await readFile(join(base, 'normalized', 'tkc', f), 'utf8'));
      for (const r of payload.records) known.add(r.contentHash);
    }
    await writeFile(join(inbox, 'a-copy.csv'), SHIWAKE_CSV, 'utf8');
    const second = await syncTkcInbox(base, '2026-08-10T02:00:00.000Z', known);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(2);
  });

  it('判定不能な形式はrejectedへ移動し理由を記録する', async () => {
    const inbox = join(base, 'import', 'tkc', 'inbox');
    await mkdir(inbox, { recursive: true });
    await writeFile(join(inbox, 'unknown.csv'), 'foo,bar\n1,2\n', 'utf8');
    const result = await syncTkcInbox(base, '2026-08-10T01:00:00.000Z');
    expect(result.rejected).toBe(1);
    expect(result.errors[0]).toContain('形式を判定できません');
    expect((await readdir(join(base, 'import', 'tkc', 'rejected'))).length).toBe(1);
  });
});

describe('decode/parse utilities', () => {
  it('CSVの引用符・改行・BOMを処理する', () => {
    const { text, encoding } = decodeBuffer(Buffer.from('﻿a,b\n"x,y",2\n', 'utf8'));
    expect(encoding).toBe('utf-8-bom');
    const rows = parseCsv(text);
    expect(rows[1][0]).toBe('x,y');
  });

  it('Shift_JISを判定して読める', () => {
    const sjis = Buffer.from([0x93, 0xfa, 0x95, 0x74]); // 「日付」
    const { text, encoding } = decodeBuffer(sjis);
    expect(encoding).toBe('shift_jis');
    expect(text).toBe('日付');
  });
});
