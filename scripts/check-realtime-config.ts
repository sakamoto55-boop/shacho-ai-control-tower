import 'dotenv/config';
/**
 * リアルタイム連携の設定チェック（構成訂正§4）。実行: npm run check:realtime
 * 各項目をPRESENT/CONFIG_REQUIREDで表示（値は表示しない）。実接続の合否はここでは判定しない。
 */
import { existsSync } from 'node:fs';
import { loadSaCredentials } from '../src/command/integrations/common/googleSaAuth.js';
import { loadGmailConfig, resolveGmailAuthState } from '../src/command/integrations/gmail/gmailClient.js';
import { loadGmailState } from '../src/command/integrations/gmail/gmailSync.js';

const p = (label: string, ok: boolean, note = '') =>
  console.log(`${ok ? 'PRESENT ' : 'MISSING '} ${label}${note ? `  — ${note}` : ''}`);

console.log('== Google共通 ==');
p('GOOGLE_SERVICE_ACCOUNT_FILE（Pub/Sub Subscriber用SA）', Boolean(loadSaCredentials()));
p('GCP_PROJECT_ID', Boolean(process.env.GCP_PROJECT_ID));

console.log('== Gmail（Pull方式・gmail.readonlyのみ） ==');
const gc = loadGmailConfig();
p('GMAIL_CLIENT_ID', Boolean(gc.clientId));
p('GMAIL_CLIENT_SECRET', Boolean(gc.clientSecret));
p('GMAIL_PUBSUB_TOPIC', Boolean(gc.pubsubTopic));
p('GMAIL_PUBSUB_SUBSCRIPTION', Boolean(process.env.GMAIL_PUBSUB_SUBSCRIPTION ?? process.env.GCP_PROJECT_ID));
p('OAuth token（初回認証済みか）', existsSync(gc.tokenFile), existsSync(gc.tokenFile) ? '' : '未認証: npm run gmail:authorize で1回だけ認証');
const auth = resolveGmailAuthState();
console.log(`gmail auth state: ${auth.state}${auth.state === 'CONFIG_REQUIRED' ? `（${auth.reason}）` : ''}`);
const gs = loadGmailState();
console.log(`gmail state: historyId=${gs.historyId ?? '—'} watchExpiration=${gs.watchExpiration ?? '—'} lastSuccessfulFetchAt=${gs.lastSuccessfulFetchAt ?? '—'}`);

console.log('== LINE WORKS（Cloud Run relay方式） ==');
p('LINEWORKS_PUBSUB_SUBSCRIPTION', Boolean(process.env.LINEWORKS_PUBSUB_SUBSCRIPTION ?? process.env.GCP_PROJECT_ID));
console.log('relay側（Cloud Run env）: PUBSUB_TOPIC / LINEWORKS_BOT_SECRET(Secret Manager) / LINEWORKS_ALLOWED_BOT_IDS — deploy時に設定');
console.log('');
console.log('注: 実着信を確認するまでGmail/LINE WORKSをLIVE_APIとは報告しません。');
