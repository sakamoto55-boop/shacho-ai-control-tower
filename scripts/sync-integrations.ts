import 'dotenv/config';
/**
 * 統合同期ランナー（夜間統合運転 §14）。read-only / incremental / idempotent。
 *
 * 使い方: npx tsx scripts/sync-integrations.ts [all|board|drive|freee|tkc|conversations]
 * - 排他制御: data/locks/sync.lock（PID+開始時刻。存在すれば二重起動を拒否）
 * - ログ: logs/integrations/sync-YYYYMMDD.jsonl（秘密情報・顧客名は出さない）
 * - Sourceへの書き込みは行わない。
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { syncTkcInbox } from '../src/command/integrations/tkc/tkcImport.js';
import { importConversationExports } from '../src/command/integrations/conversations/conversationImport.js';
import { loadFreeeConfig, resolveAuthState } from '../src/command/integrations/freee/freeeClient.js';
import type { SyncResult } from '../src/command/integrations/common/types.js';

const DATA_DIR = process.env.LCC_INTEGRATION_DATA_DIR ?? './data';
const LOCK_FILE = join(DATA_DIR, 'locks', 'sync.lock');
const LOG_DIR = './logs/integrations';

function log(entry: Record<string, unknown>): void {
  mkdirSync(LOG_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  appendFileSync(join(LOG_DIR, `sync-${day}.jsonl`), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

function acquireLock(): boolean {
  mkdirSync(join(DATA_DIR, 'locks'), { recursive: true });
  if (existsSync(LOCK_FILE)) {
    try {
      const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8')) as { pid: number; startedAt: string };
      // 6時間超の残留lockはstaleとして回収
      if (Date.now() - Date.parse(lock.startedAt) < 6 * 3600_000) return false;
    } catch {
      // 壊れたlockは回収
    }
  }
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
  return true;
}

async function syncBoard(syncedAt: string): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  try {
    const { createCommandRepository } = await import('../src/command/repositories/CommandRepository.js');
    const repository = createCommandRepository();
    const dataset = await repository.getDataset(syncedAt);
    return {
      source: 'board(lcc-integrated-db)',
      status: 'LIVE_READ_ONLY',
      startedAt,
      finishedAt: new Date().toISOString(),
      processed: dataset.customers.length + dataset.projects.length,
      imported: 0,
      rejected: 0,
      duplicates: 0,
      errors: [],
      note: `customers=${dataset.customers.length} projects=${dataset.projects.length}（既存Sheets SA接続・カンバンボードの正本）`
    };
  } catch (error) {
    return {
      source: 'board(lcc-integrated-db)',
      status: 'BLOCKED_TECHNICAL',
      startedAt,
      finishedAt: new Date().toISOString(),
      processed: 0,
      imported: 0,
      rejected: 0,
      duplicates: 0,
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function syncFreee(): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const state = resolveAuthState(loadFreeeConfig('.'));
  const base: SyncResult = {
    source: 'freee-hr',
    status: 'ADMIN_SETUP_REQUIRED',
    startedAt,
    finishedAt: new Date().toISOString(),
    processed: 0,
    imported: 0,
    rejected: 0,
    duplicates: 0,
    errors: []
  };
  if (state.state === 'ADMIN_SETUP_REQUIRED') return { ...base, note: state.reason };
  if (state.state === 'AUTH_REQUIRED') {
    return { ...base, status: 'AUTH_REQUIRED', note: '認可URLはMORNING_HANDOFF参照（社長のブラウザ承認が必要）' };
  }
  return { ...base, status: 'LIVE_READ_ONLY', note: 'token検証済み（実データ取得は個別sync実装で実施）' };
}

async function syncConversations(syncedAt: string): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const result = await importConversationExports(DATA_DIR, syncedAt);
  const written = (result.chatgpt?.written ?? 0) + (result.gemini?.written ?? 0);
  const dup = (result.chatgpt?.duplicates ?? 0) + (result.gemini?.duplicates ?? 0);
  return {
    source: 'conversations(chatgpt/gemini export)',
    status: 'LOCAL_IMPORT_READY',
    startedAt,
    finishedAt: new Date().toISOString(),
    processed: written + dup,
    imported: written,
    rejected: result.errors.length,
    duplicates: dup,
    errors: result.errors,
    note: '正式export ZIPの中身（conversations.json / MyActivity.json）をdata/import/conversations/<provider>/inboxへ'
  };
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? 'all';
  if (!acquireLock()) {
    console.error('[sync] 別のsyncが実行中です（data/locks/sync.lock）。二重起動を中止します。');
    process.exitCode = 1;
    return;
  }
  const syncedAt = new Date().toISOString();
  const results: SyncResult[] = [];
  try {
    if (target === 'all' || target === 'board') results.push(await syncBoard(syncedAt));
    if (target === 'all' || target === 'tkc') results.push(await syncTkcInbox(DATA_DIR, syncedAt));
    if (target === 'all' || target === 'conversations') results.push(await syncConversations(syncedAt));
    if (target === 'all' || target === 'freee') results.push(await syncFreee());
    if (target === 'drive') {
      results.push({
        source: 'gdrive-finance',
        status: 'ADMIN_SETUP_REQUIRED',
        startedAt: syncedAt,
        finishedAt: new Date().toISOString(),
        processed: 0,
        imported: 0,
        rejected: 0,
        duplicates: 0,
        errors: [],
        note: 'Service AccountはSheets読み取りのみ。経理xlsx群はSA共有+Driveスコープ付与、またはdata/import経由'
      });
    }
    for (const r of results) {
      log({ source: r.source, status: r.status, processed: r.processed, imported: r.imported, rejected: r.rejected, duplicates: r.duplicates, errors: r.errors.length });
      console.log(`[sync] ${r.source}: ${r.status} processed=${r.processed} imported=${r.imported} rejected=${r.rejected} dup=${r.duplicates}${r.note ? ` — ${r.note}` : ''}`);
    }
  } finally {
    rmSync(LOCK_FILE, { force: true });
  }
}

main().catch((error) => {
  console.error('[sync] 失敗:', error instanceof Error ? error.message : error);
  rmSync(LOCK_FILE, { force: true });
  process.exitCode = 1;
});
