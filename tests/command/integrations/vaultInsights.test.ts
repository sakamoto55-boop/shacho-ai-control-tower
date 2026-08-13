import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dailyOps, projectFinance, actionItems } from '../../../src/command/integrations/knowledge/vaultInsights.js';
import { createCommandApp } from '../../../src/command/server/routes.js';
import { InMemoryCommandRepository } from '../../../src/command/repositories/CommandRepository.js';
import type { CommandChatResponse } from '../../../src/command/domain/types.js';

const ASOF = '2026-08-08T00:00:00.000Z';

function writeVault(dir: string, key: string, rows: object[]): void {
  writeFileSync(join(dir, 'raw', `${key}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

const env = (sheet: string, row: number, raw: Record<string, string>, extra: object = {}) => ({
  sourceSystem: 'sheets:test',
  sourceRecordId: `${sheet}:row${row}`,
  sourceSheet: sheet,
  sourceRow: row,
  syncedAt: '2026-08-08T00:30:00.000Z',
  evidence: [{ source: 'spreadsheet:test', locator: `${sheet}!row${row}` }],
  raw,
  ...extra
});

describe('vaultInsights（決定論・実データ形状のfixture）', () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'lcc-vault-'));
    mkdirSync(join(vaultDir, 'raw'), { recursive: true });
    writeVault(vaultDir, 'daily-report-ai', [
      env('日報データ', 2, { 日付: '2026-08-08', 現場: 'A現場', 区分: '請負', 作業員: 'X', 工数: '1', 車両: '', 'AI信頼度': '高', 確認ステータス: '未確認', '確定（✔で転記対象）': '' }),
      env('日報データ', 3, { 日付: '2026-08-08', 現場: 'A現場', 区分: '請負', 作業員: 'Y', 工数: '0.5', 車両: '', 'AI信頼度': '低', 確認ステータス: '未確認', '確定（✔で転記対象）': '' }),
      env('日報データ', 4, { 日付: '2026-08-08', 現場: '', 区分: '休', 作業員: 'Z', 工数: '', 車両: '', 'AI信頼度': '高', 確認ステータス: '未確認', '確定（✔で転記対象）': '✔' }),
      env('日報データ', 5, { 日付: '2026-08-07', 現場: 'B現場', 区分: '常用', 作業員: 'W', 工数: '1', 車両: '', 'AI信頼度': '中', 確認ステータス: '未確認', '確定（✔で転記対象）': '' }),
      // backupタブは集計から除外されること（二重計上防止）
      env('日報データ_bk20260714_2000', 2, { 日付: '2026-08-08', 現場: 'A現場', 区分: '請負', 作業員: 'X', 工数: '1', 車両: '', 'AI信頼度': '高', 確認ステータス: '未確認', '確定（✔で転記対象）': '' })
    ]);
    writeVault(vaultDir, 'lcc-integrated-db', [
      env('projects', 2, { id: 'prj_t1', name: 'テスト様邸　解体工事', customerName: 'テスト様', type: '解体', status: 'contract', estimateAmount: '350000', estimateTotal: '385000', cost: '250000', grossProfit: '100000', grossProfitRate: '28.6', invoiceAmount: '0', invoiceTotal: '385000', billingStatus: 'none', payments_json: '[]', orderDate: '2026-07-01T00:00:00.000Z', workStart: '', workEnd: '', staff: '担当A' }),
      env('projects', 3, { id: 'prj_t2', name: '未入力案件', customerName: '', type: 'その他', status: 'quote', estimateAmount: '0', estimateTotal: '0', cost: '0', grossProfit: '0', grossProfitRate: '0', invoiceAmount: '0', invoiceTotal: '0', billingStatus: 'none', payments_json: '[]', orderDate: '', workStart: '', workEnd: '', staff: '' })
    ]);
    writeVault(vaultDir, 'lcc-case-db', [
      env('05_documents', 2, { doc_id: 'd1', project_id: 'prj_t1', doc_type: 'asbestos', doc_state: '要確認', due_at: '', submitted_at: '' }),
      env('05_documents', 3, { doc_id: 'd2', project_id: 'prj_t1', doc_type: 'manifest', doc_state: '要確認', due_at: '', submitted_at: '' })
    ]);
    writeVault(vaultDir, 'lineworks-inbox', [
      env('lineworks_inbox', 2, { 受信日時: '2026/08/08 09:00:00', ID: 'u1', 送信者: 's1', 本文: '熱中症に注意してください', 取得状態: '取得済' }, { normalized: { extractionCandidates: ['事故・危険: 熱中症'] } }),
      env('lineworks_inbox', 3, { 受信日時: '2026/08/08 10:00:00', ID: 'u2', 送信者: 's2', 本文: '完了しました', 取得状態: '取得済' }, { normalized: { extractionCandidates: ['報告: 完了'] } })
    ]);
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true });
    delete process.env.LCC_INTEGRATION_VAULT_DIR;
  });

  it('dailyOps: backupタブを除外し、区分・工数・確定状況を決定論集計する', () => {
    const ops = dailyOps('2026-08-08', vaultDir);
    expect(ops.targetDate).toBe('2026-08-08');
    expect(ops.usedFallbackDate).toBe(false);
    expect(ops.sites.length).toBe(3); // backupタブの1行は含まれない
    expect(ops.kubunBreakdown['請負']).toBe(2);
    expect(ops.kubunBreakdown['休']).toBe(1);
    expect(ops.kosuTotal).toBe(1.5);
    expect(ops.confirmedCount).toBe(1);
    expect(ops.unconfirmedCount).toBe(2);
    expect(ops.assignments.state).toBe('NOT_CONNECTED'); // 欠員は推測しない
  });

  it('dailyOps: 指定日に行がなければ直近日へフォールバックし明示する', () => {
    const ops = dailyOps('2026-08-09', vaultDir);
    expect(ops.usedFallbackDate).toBe(true);
    expect(ops.targetDate).toBe('2026-08-08');
    expect(ops.notes.join()).toContain('2026-08-09');
  });

  it('projectFinance: 部分一致で特定し、0/空欄は未入力(null)・入金はNOT_AVAILABLE', () => {
    const card = projectFinance('テスト様邸', vaultDir);
    expect(card.totalMatched).toBe(1);
    const p = card.matched[0];
    expect(p.estimateTotal).toBe(385000);
    expect(p.cost).toBe(250000);
    expect(p.grossProfit).toBe(100000);
    expect(p.invoiceTotal).toBe(385000);
    expect(p.payments.state).toBe('NOT_AVAILABLE');
    expect(p.legalDocs?.total).toBe(2);
    expect(p.legalDocs?.byType['asbestos']).toBe(1);
    const empty = projectFinance('未入力案件', vaultDir).matched[0];
    expect(empty.estimateTotal).toBeNull(); // 0は0円と断定せず未入力
    expect(empty.cost).toBeNull();
  });

  it('actionItems: 事故・危険を最優先にし、報告は要対応へ含めない', () => {
    const result = actionItems(vaultDir);
    expect(result.items[0].category).toBe('事故・危険');
    expect(result.items.some((i) => i.category === '報告')).toBe(false);
    expect(result.items.some((i) => i.category === '法定書類')).toBe(true);
    expect(result.items.some((i) => i.category === '日報確認')).toBe(true);
  });

  it('E2E: POST /chat の3本の縦断フローが根拠・基準日時付きで応答する', async () => {
    process.env.LCC_INTEGRATION_VAULT_DIR = vaultDir;
    const app = createCommandApp(new InMemoryCommandRepository());
    const ask = async (message: string) => {
      const res = await app.request('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, scope: 'lcc', asOf: ASOF })
      });
      expect(res.status).toBe(200);
      return (await res.json()) as CommandChatResponse;
    };
    const ops = await ask('今日の配置、欠員、未提出日報を教えて');
    expect(ops.text).toContain('確認できた事実');
    expect(ops.text).toContain('欠員');
    expect(ops.text).toContain('参照元');
    expect(ops.toolsUsed).toContain('vault_daily_ops');

    const fin = await ask('テスト様邸の受注額、原価、粗利、請求・入金状況を教えて');
    expect(fin.text).toContain('385,000円');
    expect(fin.text).toContain('入金');
    expect(fin.text).toContain('参照元');
    expect(fin.toolsUsed).toContain('vault_project_finance');
    expect(fin.evidence.length).toBeGreaterThan(0);

    const act = await ask('今日の要対応を、重要度順に根拠付きで教えて');
    expect(act.text).toContain('事故・危険');
    expect(act.text).toContain('参照元');
    expect(act.toolsUsed).toContain('vault_action_items');
  });
});

// CODEX是正1: Drive状態は固定文言でなくintegration-statusの実状態を反映
import { driveMaterialsStatus } from '../../../src/command/integrations/knowledge/vaultInsights.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

describe('Drive状態の実反映（CODEX是正1）', () => {
  it('LIVE_API時は未有効化と表示せず、metadata READ ONLYの能力範囲を明示する', () => {
    const dir = mkdtempSync(pjoin(tmpdir(), 'lcc-drv-'));
    writeFileSync(pjoin(dir, 'integration-status.json'), JSON.stringify({ sources: { gdrive: { status: 'LIVE_API', processed: 6, lastSyncedAt: '2026-08-13T12:00:00.000Z' } } }));
    const s = driveMaterialsStatus(dir);
    expect(s.state).toBe('LIVE_API');
    expect(s.reason).not.toContain('未有効化');
    expect(s.reason).toContain('metadata検索のみ');
    expect(s.reason).toContain('本文取得不可');
    expect(s.reason).toContain('6件');
  });

  it('ERROR時は同期時の実エラー理由、status未存在はNOT_CONNECTEDを返す', () => {
    const dir = mkdtempSync(pjoin(tmpdir(), 'lcc-drv-'));
    writeFileSync(pjoin(dir, 'integration-status.json'), JSON.stringify({ sources: { gdrive: { status: 'ERROR', errors: ['HTTP 403 PERMISSION_DENIED'] } } }));
    expect(driveMaterialsStatus(dir)).toEqual({ state: 'ERROR', reason: 'HTTP 403 PERMISSION_DENIED' });
    expect(driveMaterialsStatus(mkdtempSync(pjoin(tmpdir(), 'lcc-drv-'))).state).toBe('NOT_CONNECTED');
  });
});
