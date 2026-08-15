/**
 * 実PS1（setup/teardown）のmock gcloud E2E（§3是正）。
 * - 実GCPへは一切接続しない（PATH先頭のmock gcloudが全呼出を受ける）
 * - 途中失敗 → receiptが消えない → 再setupで残りだけ作成 → teardownでreceipt分のみ削除
 * - 共有repo（cloud-run-source-deploy）とCloud Build bucketを削除しないことをログとmock状態で検証
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const SETUP = join(REPO, 'scripts', 'gcloud-setup-realtime.ps1');
const TEARDOWN = join(REPO, 'scripts', 'gcloud-teardown-realtime.ps1');
const MOCK = join(__dirname, 'gcloud-mock.cjs');

function findShell(): string | null {
  for (const sh of ['pwsh', 'powershell']) {
    const r = spawnSync(sh, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (r.status === 0) return sh;
  }
  return null;
}
const SHELL = findShell();

function makeMockDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lcc-mockgc-'));
  const node = process.execPath;
  writeFileSync(join(dir, 'gcloud.cmd'), `@echo off\r\n"${node}" "${MOCK}" %*\r\n`, 'utf8');
  writeFileSync(join(dir, 'gcloud'), `#!/bin/sh\nexec "${node}" "${MOCK}" "$@"\n`, 'utf8');
  try { chmodSync(join(dir, 'gcloud'), 0o755); } catch { /* windows */ }
  return dir;
}

interface RunOpts { failMatch?: string }
function runPs1(shell: string, script: string, extraArgs: string[], env: Record<string, string>, opts: RunOpts = {}) {
  return spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...extraArgs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      ...(opts.failMatch ? { MOCK_GCLOUD_FAIL_MATCH: opts.failMatch } : { MOCK_GCLOUD_FAIL_MATCH: '' })
    }
  });
}

describe.skipIf(!SHELL)('実PS1 mock gcloud E2E（途中失敗→再setup→teardown）', () => {
  it('setup途中失敗でreceiptが残り、再実行で完走し、teardownは自作分のみ削除する', () => {
    const shell = SHELL!;
    const mockDir = makeMockDir();
    const work = mkdtempSync(join(tmpdir(), 'lcc-ps1e2e-'));
    const stateFile = join(work, 'mock-state.json');
    const logFile = join(work, 'mock-log.txt');
    const receipt = join(work, 'receipt.json');
    const env = {
      PATH: `${mockDir}${delimiter}${process.env.PATH ?? ''}`,
      MOCK_GCLOUD_STATE: stateFile,
      MOCK_GCLOUD_LOG: logFile,
      LCC_TEST_BOT_SECRET: 'mock-bot-secret-value'
    };
    const setupArgs = [
      '-ProjectId', 'mockproj', '-LccSaEmail', 'lcc-sa@mockproj.iam.gserviceaccount.com',
      '-LineworksBotId', 'bot-1', '-AutoApprove', '-BotSecretEnvVar', 'LCC_TEST_BOT_SECRET',
      '-ReceiptFile', receipt
    ];

    // --- 1. 途中失敗（outbox bucket作成で障害注入） ---
    const r1 = runPs1(shell, SETUP, setupArgs, env, { failMatch: 'buckets create' });
    expect(r1.status).not.toBe(0); // $LASTEXITCODE検査により即停止
    expect(existsSync(receipt)).toBe(true); // 途中失敗でもreceiptは消えない（成功ごとに原子的保存）
    const rec1 = JSON.parse(readFileSync(receipt, 'utf8'));
    const ids1 = rec1.created.map((c: { kind: string; id: string }) => `${c.kind}:${c.id}`);
    expect(ids1).toContain('topic:lcc-gmail-events'); // 失敗前の成功分は記録済み
    expect(ids1).not.toContain('bucket:mockproj-lineworks-outbox'); // 失敗分は記録されない
    expect(ids1.some((i: string) => i.startsWith('run-service:'))).toBe(false);

    // --- 2. 再setup（冪等: 既存skip・残りだけ作成・receiptへマージ） ---
    const r2 = runPs1(shell, SETUP, setupArgs, env);
    expect(r2.status).toBe(0);
    expect(r2.stdout).toContain('HMAC自己検査: MATCH');
    expect(r2.stdout).toContain('skip'); // 作成済みリソースはskip（再作成しない）
    const rec2 = JSON.parse(readFileSync(receipt, 'utf8'));
    const ids2 = rec2.created.map((c: { kind: string; id: string }) => `${c.kind}:${c.id}`);
    expect(ids2).toContain('bucket:mockproj-lineworks-outbox');
    expect(ids2.some((i: string) => i.startsWith('run-service:'))).toBe(true);
    expect(new Set(ids2).size).toBe(ids2.length); // 重複記録なし
    expect(ids2).toContain('iam-binding:lcc-build@mockproj.iam.gserviceaccount.com|roles/run.builder|project:mockproj');
    // 共有リソースはreceiptに載らない
    expect(ids2.some((i: string) => i.includes('cloud-run-source-deploy') && i.startsWith('repo'))).toBe(false);
    expect(ids2.some((i: string) => i.includes('cloudbuild'))).toBe(false);

    // --- 3. teardown（receipt分のみ削除・共有repo/bucket保護） ---
    const r3 = runPs1(shell, TEARDOWN, ['-ProjectId', 'mockproj', '-AutoApprove', '-ReceiptFile', receipt], env);
    expect(r3.status).toBe(0);
    const stateAfter = JSON.parse(readFileSync(stateFile, 'utf8'));
    const remaining = Object.keys(stateAfter.resources);
    expect(remaining).not.toContain('topic:lcc-gmail-events'); // 自作分は削除
    expect(remaining).not.toContain('bucket:mockproj-lineworks-outbox');
    expect(remaining).not.toContain('run:lcc-lineworks-relay@asia-northeast1');
    expect(remaining).toContain('repo:cloud-run-source-deploy'); // 共有repoは保護
    expect(remaining).toContain('bucket:mockproj_cloudbuild'); // Cloud Build bucketは保護
    expect(remaining.some((k) => k.startsWith('image:'))).toBe(false); // relayイメージのみ削除
    // build SAのproject-level bindingはreceipt記載分のみ解除済み
    expect(Object.keys(stateAfter.bindings)).not.toContain('project:mockproj|serviceAccount:lcc-build@mockproj.iam.gserviceaccount.com|roles/run.builder');
    const log = readFileSync(logFile, 'utf8');
    expect(log).not.toMatch(/repositories delete/); // 共有repoの削除コマンドを発行していない
    expect(log).not.toMatch(/rm --recursive gs:\/\/mockproj_cloudbuild/);
  }, 120_000);

  it('既存bindingは自作扱いせずreceiptへ記録しない', () => {
    const shell = SHELL!;
    const mockDir = makeMockDir();
    const work = mkdtempSync(join(tmpdir(), 'lcc-ps1pre-'));
    const stateFile = join(work, 'mock-state.json');
    const receipt = join(work, 'receipt.json');
    // 事前に「既存binding」を仕込む（gmail-api-push publisher）
    writeFileSync(stateFile, JSON.stringify({
      resources: {},
      bindings: { 'topic:lcc-gmail-events|serviceAccount:gmail-api-push@system.gserviceaccount.com|roles/pubsub.publisher': 1 },
      secretData: ''
    }), 'utf8');
    const env = {
      PATH: `${mockDir}${delimiter}${process.env.PATH ?? ''}`,
      MOCK_GCLOUD_STATE: stateFile,
      MOCK_GCLOUD_LOG: join(work, 'log.txt'),
      LCC_TEST_BOT_SECRET: 's'
    };
    const r = runPs1(shell, SETUP, [
      '-ProjectId', 'mockproj', '-LccSaEmail', 'lcc-sa@mockproj.iam.gserviceaccount.com',
      '-LineworksBotId', 'bot-1', '-AutoApprove', '-BotSecretEnvVar', 'LCC_TEST_BOT_SECRET',
      '-ReceiptFile', receipt
    ], env);
    expect(r.status).toBe(0);
    const rec = JSON.parse(readFileSync(receipt, 'utf8'));
    const ids = rec.created.map((c: { kind: string; id: string }) => `${c.kind}:${c.id}`);
    expect(ids.some((i: string) => i.includes('gmail-api-push'))).toBe(false); // 既存bindingを自作扱いしない
    expect(r.stdout).toContain('binding既存');
  }, 120_000);
});
