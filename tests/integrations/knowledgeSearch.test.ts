/**
 * Knowledge Search V1テスト（実用到達テスト2-5・7-10の検証）。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  searchKnowledge,
  tokenizeQuery
} from '../../src/command/integrations/knowledge/knowledgeSearch.js';

function record(sourceSystem: string, sheet: string, row: number, raw: Record<string, string>) {
  return JSON.stringify({
    sourceSystem,
    sourceRecordId: `${sheet}:row${row}`,
    companyId: 'lcc',
    sourceRecordUpdatedAt: null,
    syncedAt: '2026-08-10T02:00:00.000Z',
    rawStatus: null,
    normalizedStatus: null,
    confidence: 'HIGH',
    freshnessStatus: 'UNKNOWN',
    evidence: [{ source: 'spreadsheet:test', locator: `${sheet}!row${row}` }],
    sourceFile: null,
    sourceSheet: sheet,
    sourceRow: row,
    contentHash: `hash-${sheet}-${row}`,
    raw,
    normalized: {}
  });
}

function makeVault(): string {
  const vaultDir = mkdtempSync(join(tmpdir(), 'knowledge-'));
  mkdirSync(join(vaultDir, 'raw'), { recursive: true });
  writeFileSync(
    join(vaultDir, 'raw', 'lcc-integrated-db.jsonl'),
    [
      record('sheets:lcc-integrated-db', 'projects', 2, { 案件名: '本郷様邸 解体工事', 顧客名: '本郷太郎' }),
      record('sheets:lcc-integrated-db', 'projects', 3, { 案件名: '本郷様邸 外構工事', 顧客名: '本郷次郎' })
    ].join('\n') + '\n',
    'utf8'
  );
  writeFileSync(
    join(vaultDir, 'raw', 'daily-report-ai.jsonl'),
    record('sheets:daily-report-ai', '日報', 5, { 現場名: '本郷様邸 解体', 作業内容: '重機搬入', 確定: '' }) + '\n',
    'utf8'
  );
  writeFileSync(
    join(vaultDir, 'raw', 'lineworks-inbox.jsonl'),
    record('sheets:lineworks-inbox', 'lineworks_inbox', 7, { 本文: '本郷様邸の解体、明日から入ります' }) + '\n',
    'utf8'
  );
  // lcc-case-db は未接続（ファイルなし）
  return vaultDir;
}

describe('Knowledge Search V1', () => {
  it('トークン化: 様邸・助詞で内容語に分割される', () => {
    const tokens = tokenizeQuery('本郷様邸の解体工事');
    expect(tokens).toContain('本郷');
    expect(tokens).toContain('解体工事');
  });

  it('(2)(3) 案件名から関連日報・LINE WORKSメッセージを横断検索できる', () => {
    const result = searchKnowledge('本郷様邸 解体', { vaultDir: makeVault() });
    const systems = new Set(result.hits.map((h) => h.sourceSystem));
    expect(systems).toContain('sheets:daily-report-ai');
    expect(systems).toContain('sheets:lineworks-inbox');
    expect(systems).toContain('sheets:lcc-integrated-db');
  });

  it('(6) 全ヒットがEvidence・syncedAt・行位置を持つ', () => {
    const result = searchKnowledge('本郷様邸 解体', { vaultDir: makeVault() });
    for (const hit of result.hits) {
      expect(hit.evidence.length).toBeGreaterThan(0);
      expect(hit.syncedAt).toBeTruthy();
      expect(hit.sourceRow).toBeGreaterThan(0);
    }
  });

  it('(7) 同名別顧客を誤統合しない: 結果はLOW候補で、別行は別ヒットのまま', () => {
    const result = searchKnowledge('本郷様邸', { vaultDir: makeVault() });
    const projects = result.hits.filter((h) => h.sourceSystem === 'sheets:lcc-integrated-db');
    expect(projects.length).toBe(2); // 解体と外構は統合されない
    for (const hit of result.hits) expect(hit.linkConfidence).toBe('LOW');
    expect(result.note).toContain('候補');
  });

  it('(10) 未接続Sourceは0件と断定せずNOT_CONNECTEDと表示する', () => {
    const result = searchKnowledge('本郷様邸', { vaultDir: makeVault() });
    const caseDb = result.sources.find((s) => s.key === 'lcc-case-db');
    expect(caseDb?.status).toBe('NOT_CONNECTED');
  });

  it('無関係なクエリはヒット0件（捏造しない）', () => {
    const result = searchKnowledge('存在しない架空案件XYZ', { vaultDir: makeVault() });
    expect(result.hits).toHaveLength(0);
  });
});
