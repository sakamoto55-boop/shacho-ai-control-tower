#!/usr/bin/env node
/**
 * mock gcloud（PS1実行E2E用）。実GCPへは一切接続しない。
 * - 状態: env MOCK_GCLOUD_STATE のJSONファイル（resources/bindings/secretData）
 * - ログ: env MOCK_GCLOUD_LOG へ全呼出のargsを追記（検証用）
 * - 障害注入: env MOCK_GCLOUD_FAIL_MATCH がargs文字列に部分一致したら exit 1
 */
const fs = require('node:fs');

const args = process.argv.slice(2);
const joined = args.join(' ');
const stateFile = process.env.MOCK_GCLOUD_STATE;
const logFile = process.env.MOCK_GCLOUD_LOG;
if (logFile) fs.appendFileSync(logFile, `${joined}\n`, 'utf8');

const state = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  : { resources: {}, bindings: {}, secretData: '' };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
const ok = (out = '') => { if (out) process.stdout.write(out); process.exit(0); };
const fail = (code = 1, msg = '') => { if (msg) process.stderr.write(msg); process.exit(code); };

if (process.env.MOCK_GCLOUD_FAIL_MATCH && joined.includes(process.env.MOCK_GCLOUD_FAIL_MATCH)) {
  fail(1, `mock injected failure: ${process.env.MOCK_GCLOUD_FAIL_MATCH}\n`);
}

const opt = (name) => {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : '';
};
const project = opt('--project') || 'mock-project';
const region = opt('--region') || 'asia-northeast1';
const has = (k) => Boolean(state.resources[k]);
const add = (k) => { state.resources[k] = 1; save(); };
const del = (k) => { delete state.resources[k]; save(); };
const positional = (afterIdx) => args.slice(afterIdx).find((a) => !a.startsWith('--'));

// ---- config / projects ----
if (joined.startsWith('config get-value account')) ok('tester@example.com\n');
if (joined.startsWith('config get-value project')) ok(`${project}\n`);
if (args[0] === 'projects' && args[1] === 'describe') ok(`${project} 123456789 ACTIVE\n`);
if (args[0] === 'projects' && args[1] === 'get-iam-policy') {
  const filter = opt('--filter');
  const m = /bindings\.role=(\S+) AND bindings\.members=(\S+)/.exec(filter ?? '');
  if (m) {
    const key = `project:${args[2]}|${m[2]}|${m[1]}`;
    ok(state.bindings[key] ? `${m[1]}\n` : '');
  }
  ok('roles/owner\n'); // deployer preflight
}
if (args[0] === 'projects' && args[1] === 'add-iam-policy-binding') {
  state.bindings[`project:${args[2]}|${opt('--member')}|${opt('--role')}`] = 1; save(); ok('updated\n');
}
if (args[0] === 'projects' && args[1] === 'remove-iam-policy-binding') {
  delete state.bindings[`project:${args[2]}|${opt('--member')}|${opt('--role')}`]; save(); ok('updated\n');
}

// ---- services ----
if (args[0] === 'services' && args[1] === 'enable') ok('enabled\n');

// ---- 汎用 IAM（pubsub topics/subscriptions・secrets・storage buckets） ----
function iamKindOf() {
  if (args[0] === 'pubsub' && args[1] === 'topics') return { kind: 'topic', name: args[3], cmd: args[2] };
  if (args[0] === 'pubsub' && args[1] === 'subscriptions') return { kind: 'subscription', name: args[3], cmd: args[2] };
  if (args[0] === 'secrets' && ['get-iam-policy', 'add-iam-policy-binding', 'remove-iam-policy-binding'].includes(args[1])) return { kind: 'secret', name: args[2], cmd: args[1] };
  if (args[0] === 'storage' && args[1] === 'buckets' && ['get-iam-policy', 'add-iam-policy-binding', 'remove-iam-policy-binding'].includes(args[2])) return { kind: 'bucket', name: String(args[3]).replace('gs://', ''), cmd: args[2] };
  return null;
}
const iam = iamKindOf();
if (iam && iam.cmd === 'get-iam-policy') {
  const m = /bindings\.role=(\S+) AND bindings\.members=(\S+)/.exec(opt('--filter') ?? '');
  if (m) ok(state.bindings[`${iam.kind}:${iam.name}|${m[2]}|${m[1]}`] ? `${m[1]}\n` : '');
  ok('{}\n');
}
if (iam && iam.cmd === 'add-iam-policy-binding') {
  state.bindings[`${iam.kind}:${iam.name}|${opt('--member')}|${opt('--role')}`] = 1; save(); ok('updated\n');
}
if (iam && iam.cmd === 'remove-iam-policy-binding') {
  delete state.bindings[`${iam.kind}:${iam.name}|${opt('--member')}|${opt('--role')}`]; save(); ok('updated\n');
}

// ---- pubsub ----
if (args[0] === 'pubsub') {
  const kind = args[1] === 'topics' ? 'topic' : 'subscription';
  const cmd = args[2]; const name = args[3];
  if (cmd === 'describe') (has(`${kind}:${name}`) ? ok('exists\n') : fail(1));
  if (cmd === 'create') { add(`${kind}:${name}`); ok('created\n'); }
  if (cmd === 'delete') { del(`${kind}:${name}`); ok('deleted\n'); }
}

// ---- secrets ----
if (args[0] === 'secrets') {
  if (args[1] === 'describe') (has(`secret:${args[2]}`) ? ok('exists\n') : fail(1));
  if (args[1] === 'create') { state.secretData = fs.readFileSync(opt('--data-file'), 'utf8'); add(`secret:${args[2]}`); ok('created\n'); }
  if (args[1] === 'versions' && args[2] === 'add') { state.secretData = fs.readFileSync(opt('--data-file'), 'utf8'); save(); ok('added\n'); }
  if (args[1] === 'versions' && args[2] === 'access') ok(state.secretData);
  if (args[1] === 'delete') { del(`secret:${args[2]}`); ok('deleted\n'); }
}

// ---- iam service accounts ----
if (args[0] === 'iam' && args[1] === 'service-accounts') {
  if (args[2] === 'describe') (has(`sa:${args[3]}`) ? ok('exists\n') : fail(1));
  if (args[2] === 'create') { add(`sa:${args[3]}@${project}.iam.gserviceaccount.com`); ok('created\n'); }
  if (args[2] === 'delete') { del(`sa:${args[3]}`); ok('deleted\n'); }
}

// ---- storage ----
if (args[0] === 'storage' && args[1] === 'buckets') {
  const bucket = String(args[3] ?? '').replace('gs://', '');
  if (args[2] === 'describe') (has(`bucket:${bucket}`) ? ok('exists\n') : fail(1));
  if (args[2] === 'create') { add(`bucket:${bucket}`); ok('created\n'); }
}
if (args[0] === 'storage' && args[1] === 'rm') {
  del(`bucket:${String(positional(2) ?? '').replace('gs://', '')}`); ok('removed\n');
}

// ---- run ----
if (args[0] === 'run' && args[1] === 'deploy') {
  add(`run:${args[2]}@${region}`);
  // --source deployの自動作成分（共有扱い）
  add('repo:cloud-run-source-deploy');
  add(`bucket:${project}_cloudbuild`);
  add(`image:${region}-docker.pkg.dev/${project}/cloud-run-source-deploy/${args[2]}`);
  ok(`Service URL: https://${args[2]}-mock.a.run.app\n`);
}
if (args[0] === 'run' && args[1] === 'services') {
  if (args[2] === 'describe') (has(`run:${args[3]}@${region}`) ? ok('exists\n') : fail(1));
  if (args[2] === 'delete') { del(`run:${args[3]}@${region}`); ok('deleted\n'); }
  if (args[2] === 'remove-iam-policy-binding') ok('updated\n');
}

// ---- artifacts ----
if (args[0] === 'artifacts' && args[1] === 'docker' && args[2] === 'images') {
  const path = args[4];
  if (args[3] === 'list') (has(`image:${path}`) ? ok('image\n') : fail(1));
  if (args[3] === 'delete') { del(`image:${path}`); ok('deleted\n'); }
}
if (args[0] === 'artifacts' && args[1] === 'repositories' && args[2] === 'delete') {
  del(`repo:${args[3]}`); ok('deleted\n'); // teardownはこれを呼ばないこと（ログで検証）
}

fail(1, `mock gcloud: unhandled command: ${joined}\n`);
