/**
 * freee実データ同期テスト（GAP AUDIT §14: incremental / duplicate prevention / read-only）。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncFreeeData } from '../../src/command/integrations/freee/freeeSyncData.js';
import type { FreeeClient } from '../../src/command/integrations/freee/freeeClient.js';

function fakeClient(): FreeeClient & { calls: string[] } {
  const calls: string[] = [];
  const client = {
    calls,
    async listCompanies() {
      calls.push('GET /users/me');
      return [{ id: 1, name: 'LCC株式会社' }];
    },
    async get(path: string) {
      calls.push(`GET ${path}`);
      if (path.includes('/employees?')) return [{ id: 10, display_name: 'X', updated_at: '2026-08-01T00:00:00Z' }];
      if (path.startsWith('/groups')) return [{ id: 20, name: '解体' }];
      if (path.startsWith('/positions')) return [{ id: 30, name: '主任' }];
      if (path.startsWith('/employee_group_memberships')) return [{ id: 40 }];
      if (path.includes('work_record_summaries')) return { year: 2026, month: 8, total: 160 };
      if (path.includes('holiday_pools')) throw new Error('freee API GET に失敗しました（HTTP 404）');
      return {};
    },
    async getTimeClocks() {
      calls.push('GET time_clocks');
      return [{ id: 50, datetime: '2026-08-09T08:00:00Z', type: 'clock_in' }];
    }
  };
  return client as unknown as FreeeClient & { calls: string[] };
}

describe('freee実データ同期', () => {
  it('実レコードをVaultへ取込み、Evidence・syncedAt・contentHashを持つ（read-only）', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'freee-'));
    const client = fakeClient();
    const summary = await syncFreeeData(client, { vaultDir, syncedAt: '2026-08-10T05:00:00.000Z' });
    expect(summary.companyName).toBe('LCC株式会社');
    expect(summary.writesToSource).toBe(0);
    // GET以外を一切呼ばない
    expect(client.calls.every((c) => c.startsWith('GET'))).toBe(true);
    const employees = readFileSync(join(vaultDir, 'raw', 'freee-employees.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l));
    expect(employees).toHaveLength(1);
    expect(employees[0].sourceRecordId).toBe('10');
    expect(employees[0].sourceRecordUpdatedAt).toBe('2026-08-01T00:00:00Z');
    expect(employees[0].syncedAt).toBe('2026-08-10T05:00:00.000Z');
    expect(employees[0].evidence[0].source).toBe('freee-hr-api');
    expect(employees[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2回目の同期は全件duplicatesで再登録されない（idempotent）', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'freee-'));
    await syncFreeeData(fakeClient(), { vaultDir, syncedAt: '2026-08-10T05:00:00.000Z' });
    const second = await syncFreeeData(fakeClient(), { vaultDir, syncedAt: '2026-08-10T06:00:00.000Z' });
    const imported = second.kinds.reduce((s, k) => s + k.imported, 0);
    const dup = second.kinds.reduce((s, k) => s + k.duplicates, 0);
    expect(imported).toBe(0);
    expect(dup).toBeGreaterThan(0);
  });

  it('404はENDPOINT_UNAVAILABLEとして区別する（推測で0件にしない）', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'freee-'));
    const summary = await syncFreeeData(fakeClient(), { vaultDir, syncedAt: '2026-08-10T05:00:00.000Z' });
    const pools = summary.kinds.find((k) => k.kind === 'holiday-pools');
    expect(pools?.outcome).toBe('ENDPOINT_UNAVAILABLE');
    const clocks = summary.kinds.find((k) => k.kind === 'time-clocks');
    expect(clocks?.outcome).toBe('FETCHED');
    expect(clocks?.period).toBeTruthy();
  });
});
