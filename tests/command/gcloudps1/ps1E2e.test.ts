/**
 * 実PS1（setup/teardown）のmock gcloud E2E。実GCPへは一切接続しない（PATH先頭のmock gcloudが全呼出を受ける）。
 * A. 既存topic+bindingなし → setup → teardown後、topicは残りpublisher bindingだけ消える
 * B. 未所有の既存Cloud Run/Secret → 変更前にCONFIG_COLLISION停止（設定・IAM・version数が不変）
 * C. gcloud成功直後の強制停止 → 再setup（PENDING reconcile）→ teardownで孤児0
 * D. 途中失敗→receipt残存→再setup→teardown（共有repo/bucket保護・digestのみ削除・既存binding非記録）
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

interface Env { PATH: string; MOCK_GCLOUD_STATE: string; MOCK_GCLOUD_LOG: string; LCC_TEST_BOT_SECRET: string; MOCK_GCLOUD_FAIL_MATCH?: string; MOCK_GCLOUD_KILL_AFTER?: string }
function runPs1(shell: string, script: string, extraArgs: string[], env: Env) {
  return spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, MOCK_GCLOUD_FAIL_MATCH: '', MOCK_GCLOUD_KILL_AFTER: '', ...env }
  });
}
function mkWorkspace(seedState?: object) {
  const mockDir = makeMockDir();
  const work = mkdtempSync(join(tmpdir(), 'lcc-ps1-'));
  const stateFile = join(work, 'mock-state.json');
  const logFile = join(work, 'mock-log.txt');
  const receipt = join(work, 'receipt.json');
  if (seedState) writeFileSync(stateFile, JSON.stringify(seedState), 'utf8');
  const env: Env = { PATH: `${mockDir}${delimiter}${process.env.PATH ?? ''}`, MOCK_GCLOUD_STATE: stateFile, MOCK_GCLOUD_LOG: logFile, LCC_TEST_BOT_SECRET: 'mock-bot-secret-value' };
  const setupArgs = ['-ProjectId', 'mockproj', '-LccSaEmail', 'lcc-sa@mockproj.iam.gserviceaccount.com', '-LineworksBotId', 'bot-1', '-AutoApprove', '-BotSecretEnvVar', 'LCC_TEST_BOT_SECRET', '-ReceiptFile', receipt];
  const teardownArgs = ['-ProjectId', 'mockproj', '-AutoApprove', '-ReceiptFile', receipt];
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8')) as { resources: Record<string, number>; bindings: Record<string, number>; secretVersions?: number };
  const rec = () => JSON.parse(readFileSync(receipt, 'utf8')) as { created: Array<{ kind: string; id: string; status?: string; digest?: string; binding?: { member: string; role: string; targetKind: string; targetId: string } }> };
  return { env, setupArgs, teardownArgs, receipt, logFile, state, rec };
}
const GMAIL_PUSH_BINDING = 'topic:lcc-gmail-events|serviceAccount:gmail-api-push@system.gserviceaccount.com|roles/pubsub.publisher';

describe.skipIf(!SHELL)('実PS1 mock gcloud E2E', () => {
  it('A: 既存topic+bindingなし → setup → teardown後、topicは残りpublisher bindingだけ消える', () => {
    const w = mkWorkspace({ resources: { 'topic:lcc-gmail-events': 1 }, bindings: {}, secretData: '' });
    const r1 = runPs1(SHELL!, SETUP, w.setupArgs, w.env);
    expect(r1.status).toBe(0);
    expect(w.state().bindings[GMAIL_PUSH_BINDING]).toBe(1); // bindingは付与された
    const rec = w.rec();
    expect(rec.created.some((c) => c.kind === 'topic' && c.id === 'lcc-gmail-events')).toBe(false); // 既存topicは自作扱いしない
    const b = rec.created.find((c) => c.kind === 'iam-binding' && c.binding?.targetId === 'lcc-gmail-events' && c.binding?.member.includes('gmail-api-push'));
    expect(b?.binding).toEqual({ member: 'serviceAccount:gmail-api-push@system.gserviceaccount.com', role: 'roles/pubsub.publisher', targetKind: 'topic', targetId: 'lcc-gmail-events' }); // 構造化・省略なし
    expect(b?.status).toBe('COMMITTED');
    const r2 = runPs1(SHELL!, TEARDOWN, w.teardownArgs, w.env);
    expect(r2.status).toBe(0);
    expect(w.state().resources['topic:lcc-gmail-events']).toBe(1); // 既存topicは残る
    expect(w.state().bindings[GMAIL_PUSH_BINDING]).toBeUndefined(); // 自作bindingだけ消える
  }, 180_000);

  it('B: 未所有の既存Cloud Run/Secret → 他を変更する前にCONFIG_COLLISION停止（設定・IAM・version数が不変）', () => {
    const seed = {
      resources: { 'run:lcc-lineworks-relay@asia-northeast1': 1, 'secret:lineworks-bot-secret': 1 },
      bindings: { 'topic:someone-else|serviceAccount:x@y|roles/viewer': 1 },
      secretData: 'pre-existing', secretVersions: 1
    };
    const w = mkWorkspace(seed);
    const r = runPs1(SHELL!, SETUP, w.setupArgs, w.env);
    expect(r.status).toBe(3);
    expect(r.stdout).toContain('CONFIG_COLLISION');
    expect(r.stdout).toContain('Cloud Run service');
    expect(r.stdout).toContain('Secret');
    const s = w.state();
    expect(s.resources).toEqual(seed.resources); // 何も作成されていない（topic等も未作成）
    expect(s.bindings).toEqual(seed.bindings); // IAM不変
    expect(s.secretVersions).toBe(1); // secret version数不変（無記録更新なし）
    expect(existsSync(w.receipt)).toBe(false); // receiptすら生成しない
    const log = readFileSync(w.logFile, 'utf8');
    expect(log).not.toMatch(/services enable|create|add-iam-policy-binding|deploy|versions add/);
  }, 120_000);

  it('C: gcloud成功直後の強制停止 → 再setupでPENDING照合・復旧 → teardownで孤児0', () => {
    const w = mkWorkspace();
    // topic作成のgcloudは成功するがその直後にプロセス停止（receiptはPENDINGのまま）
    const r1 = runPs1(SHELL!, SETUP, w.setupArgs, { ...w.env, MOCK_GCLOUD_KILL_AFTER: 'topics create lcc-gmail-events' });
    expect(r1.status).not.toBe(0);
    expect(w.state().resources['topic:lcc-gmail-events']).toBe(1); // 外部には作られている
    const pend = w.rec().created.find((c) => c.kind === 'topic' && c.id === 'lcc-gmail-events');
    expect(pend?.status).toBe('PENDING'); // write-ahead: PENDINGのまま残っている
    // 再setup: reconcileがPENDING→COMMITTEDへ昇格（実在確認）し、残りを完走
    const r2 = runPs1(SHELL!, SETUP, w.setupArgs, w.env);
    expect(r2.status).toBe(0);
    expect(r2.stdout).toContain('reconcile: PENDING→COMMITTED');
    const rec2 = w.rec();
    expect(rec2.created.find((c) => c.kind === 'topic' && c.id === 'lcc-gmail-events')?.status).toBe('COMMITTED');
    expect(rec2.created.every((c) => c.status === 'COMMITTED')).toBe(true);
    // Artifact Registryはdigestのみ記録
    const img = rec2.created.find((c) => c.kind === 'artifact-image');
    expect(img?.digest).toMatch(/^sha256:/);
    // teardown: 孤児0（自作分は全て消え、共有は残る）
    const r3 = runPs1(SHELL!, TEARDOWN, w.teardownArgs, w.env);
    expect(r3.status).toBe(0);
    const remaining = Object.keys(w.state().resources);
    expect(remaining).not.toContain('topic:lcc-gmail-events'); // 停止直後に作られたtopicも削除（孤児にならない）
    expect(remaining.filter((k) => !k.startsWith('repo:') && !k.includes('_cloudbuild'))).toEqual([]); // 自作分は0
    expect(remaining).toContain('repo:cloud-run-source-deploy');
    expect(remaining).toContain('bucket:mockproj_cloudbuild');
    expect(Object.keys(w.state().bindings)).toEqual([]); // 自作binding全解除
  }, 240_000);

  it('D: 途中失敗→receipt残存→再setup→teardown（共有repo/bucket保護・既存binding非記録・digest単位削除）', () => {
    const w = mkWorkspace({ resources: {}, bindings: { [GMAIL_PUSH_BINDING]: 1 }, secretData: '' });
    const r1 = runPs1(SHELL!, SETUP, w.setupArgs, { ...w.env, MOCK_GCLOUD_FAIL_MATCH: 'buckets create' });
    expect(r1.status).not.toBe(0);
    expect(existsSync(w.receipt)).toBe(true);
    const rec1 = w.rec();
    expect(rec1.created.find((c) => c.kind === 'topic' && c.id === 'lcc-gmail-events')?.status).toBe('COMMITTED');
    // 失敗したbucketはwrite-aheadでPENDING記録（外部には未作成）。再setupのreconcileが削除する
    expect(rec1.created.find((c) => c.kind === 'bucket')?.status).toBe('PENDING');
    expect(w.state().resources['bucket:mockproj-lineworks-outbox']).toBeUndefined();
    const r2 = runPs1(SHELL!, SETUP, w.setupArgs, w.env);
    expect(r2.stdout).toContain('reconcile: PENDING削除（未作成）bucket');
    expect(r2.status).toBe(0);
    expect(r2.stdout).toContain('HMAC自己検査: MATCH');
    expect(r2.stdout).toContain('binding既存（他所有・自作扱いしない）');
    const rec2 = w.rec();
    expect(rec2.created.some((c) => c.binding?.member.includes('gmail-api-push'))).toBe(false); // 既存bindingは非記録
    expect(new Set(rec2.created.map((c) => `${c.kind}:${c.id}`)).size).toBe(rec2.created.length);
    expect(rec2.created.some((c) => c.id.includes('cloud-run-source-deploy') && c.kind !== 'artifact-image')).toBe(false);
    const r3 = runPs1(SHELL!, TEARDOWN, w.teardownArgs, w.env);
    expect(r3.status).toBe(0);
    const st = w.state();
    expect(Object.keys(st.resources)).toContain('repo:cloud-run-source-deploy');
    expect(Object.keys(st.resources)).toContain('bucket:mockproj_cloudbuild');
    expect(Object.keys(st.resources).some((k) => k.startsWith('image:'))).toBe(false); // digestのイメージのみ削除
    expect(st.bindings[GMAIL_PUSH_BINDING]).toBe(1); // 既存bindingは解除しない
    const log = readFileSync(w.logFile, 'utf8');
    expect(log).not.toMatch(/repositories delete/);
    expect(log).not.toMatch(/rm --recursive gs:\/\/mockproj_cloudbuild/);
    expect(log).toMatch(/images delete .*@sha256:/); // digest指定削除のみ
  }, 240_000);
});
