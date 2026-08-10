/**
 * Sheets → Raw Vault 取込テスト（TRACK B）。
 * READ ONLY・追記専用・contentHash重複排除（idempotent）・
 * sourceRecordUpdatedAt/syncedAt分離を検証する。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  syncSheetSourceToVault,
  extractLineworksCandidates,
  listTabs,
  type SheetVaultSource
} from '../../src/command/integrations/sheets/sheetsVaultSync.js';
import type { SheetsClient, SheetTable } from '../../src/command/sources/googleSheets.js';

function fakeClient(tables: Record<string, string[][]>): SheetsClient {
  return {
    async fetchTable(spreadsheetId: string, tabName: string): Promise<SheetTable> {
      const values = tables[tabName];
      if (!values) throw new Error('Sheets API 400');
      return {
        spreadsheetId,
        tabName,
        header: values[0] ?? [],
        rows: values.slice(1),
        fetchedAt: '2026-08-10T00:00:00.000Z'
      };
    }
  };
}

const SOURCE: SheetVaultSource = {
  key: 'lineworks-inbox',
  spreadsheetId: 'sheet-test',
  tabs: ['lineworks_inbox'],
  classification: 'CURRENT_EVIDENCE_SOURCE'
};

const TABLE = {
  lineworks_inbox: [
    ['メッセージID', '受信日時', 'ルームID', '送信者ID', '本文'],
    ['msg-001', '2026-08-01 09:00', 'room-1', 'user-a', '現場Aの見積をお願いします。8/15までに'],
    ['msg-002', '2026-08-01 10:00', 'room-1', 'user-b', '完了report: 特に問題ありません']
  ]
};

describe('TRACK B: Sheets Raw Vault取込', () => {
  it('READ ONLY取込: IntegrationRecord封筒でJSONLへ追記しEvidence・contentHashを持つ', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'vault-'));
    const result = await syncSheetSourceToVault(SOURCE, fakeClient(TABLE), {
      vaultDir,
      syncedAt: '2026-08-10T01:00:00.000Z'
    });
    expect(result.status).toBe('LIVE_READ_ONLY');
    expect(result.imported).toBe(2);
    const lines = readFileSync(join(vaultDir, 'raw', 'lineworks-inbox.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    // raw IDを振り直さない（メッセージID列を使用）
    expect(lines[0].sourceRecordId).toBe('msg-001');
    // Source実更新と取得時刻の分離: 実更新列が確定するまでnull（取得時刻で代用しない）
    expect(lines[0].sourceRecordUpdatedAt).toBeNull();
    expect(lines[0].syncedAt).toBe('2026-08-10T01:00:00.000Z');
    expect(lines[0].freshnessStatus).toBe('UNKNOWN');
    expect(lines[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(lines[0].evidence[0].locator).toBe('lineworks_inbox!row2');
  });

  it('idempotent: 再同期は全件duplicatesになり追記されない', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'vault-'));
    await syncSheetSourceToVault(SOURCE, fakeClient(TABLE), {
      vaultDir,
      syncedAt: '2026-08-10T01:00:00.000Z'
    });
    const second = await syncSheetSourceToVault(SOURCE, fakeClient(TABLE), {
      vaultDir,
      syncedAt: '2026-08-10T02:00:00.000Z'
    });
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(2);
    const lines = readFileSync(join(vaultDir, 'raw', 'lineworks-inbox.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
    // checkpointが更新される
    const checkpoint = JSON.parse(
      readFileSync(join(vaultDir, 'raw', 'lineworks-inbox.checkpoint.json'), 'utf8')
    );
    expect(checkpoint.lastSyncedAt).toBe('2026-08-10T02:00:00.000Z');
    expect(checkpoint.totalRecords).toBe(2);
  });

  it('LINE WORKS抽出候補は決定論キーワードで候補扱い（原文はrawに保持）', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'vault-'));
    await syncSheetSourceToVault(SOURCE, fakeClient(TABLE), {
      vaultDir,
      syncedAt: '2026-08-10T01:00:00.000Z'
    });
    const lines = readFileSync(join(vaultDir, 'raw', 'lineworks-inbox.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines[0].normalized.extractionCandidates).toContain('依頼');
    expect(lines[0].normalized.extractionCandidates).toContain('期限');
    expect(lines[0].raw['本文']).toContain('現場A');
  });

  it('取得失敗はBLOCKED_TECHNICALで正直に返す（Vaultへ書かない）', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'vault-'));
    const result = await syncSheetSourceToVault(
      { ...SOURCE, tabs: ['unknown_tab'] },
      fakeClient(TABLE),
      { vaultDir, syncedAt: '2026-08-10T01:00:00.000Z' }
    );
    expect(result.status).toBe('BLOCKED_TECHNICAL');
    expect(result.errors.length).toBe(1);
    expect(existsSync(join(vaultDir, 'raw', 'lineworks-inbox.jsonl'))).toBe(false);
  });

  it('extractLineworksCandidates: 事故・危険/決定/要確認を検出する', () => {
    expect(extractLineworksCandidates('現場でヒヤリがありました')).toContain('事故・危険');
    expect(extractLineworksCandidates('この仕様で確定します')).toContain('決定');
    expect(extractLineworksCandidates('どうしますか、ご確認ください')).toContain('要確認');
    expect(extractLineworksCandidates('おはようございます')).toHaveLength(0);
  });

  it('listTabs: メタデータAPI（GET）からタブ名を列挙する', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      expect(String(url)).toContain('fields=sheets.properties.title');
      return new Response(
        JSON.stringify({ sheets: [{ properties: { title: 'タブA' } }, { properties: { title: 'タブB' } }] }),
        { status: 200 }
      );
    }) as typeof fetch;
    const tabs = await listTabs('sheet-x', { getToken: async () => 'token' }, fetchImpl);
    expect(tabs).toEqual(['タブA', 'タブB']);
  });
});
