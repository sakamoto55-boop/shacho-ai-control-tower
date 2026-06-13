/**
 * Gmail OAuth2 セットアップスクリプト
 *
 * 使い方:
 *   npx tsx scripts/setup-gmail-oauth.ts
 *
 * このスクリプトが行うこと:
 *   1. Google Cloud Console で作成した Client ID / Secret の入力を求める
 *   2. 認証URLを表示する（ブラウザで開く）
 *   3. 認証後に表示されるコードを入力する
 *   4. Refresh Token を取得して .env ファイルに自動書き込む
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const REDIRECT_URI = 'http://localhost:4242';

const rl = createInterface({ input, output });

function ask(question: string): Promise<string> {
  return rl.question(question);
}

function line(char = '─', len = 50) {
  return char.repeat(len);
}

async function readEnvFile(path: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!existsSync(path)) return map;
  const content = await readFile(path, 'utf8');
  for (const raw of content.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return map;
}

async function writeEnvFile(path: string, values: Map<string, string>) {
  let content = existsSync(path) ? await readFile(path, 'utf8') : '';
  for (const [key, val] of values) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escapedKey}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, `${key}=${val}`);
    } else {
      content += `\n${key}=${val}`;
    }
  }
  if (!content.endsWith('\n')) content += '\n';
  await writeFile(path, content, 'utf8');
}

async function waitForCodeViaLocalServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:4242`);
      const code = url.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>認証完了！このタブを閉じてターミナルに戻ってください。</h2>');
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end('code が見つかりません');
        reject(new Error('no code in callback'));
      }
    });
    server.listen(4242, '127.0.0.1', () => {
      console.log('\n  ローカルサーバー起動 → http://localhost:4242 で認証コードを待機中...');
    });
    server.on('error', reject);
    setTimeout(() => { server.close(); reject(new Error('タイムアウト（5分）')); }, 300_000);
  });
}

async function main() {
  console.log('\n' + line('═'));
  console.log('  Gmail OAuth2 セットアップ');
  console.log(line('═'));

  console.log(`
まず Google Cloud Console で以下を設定してください。
（すでに済んでいる場合は次のステップへ）

${line()}
STEP 1: Google Cloud Console を開く
  https://console.cloud.google.com/

STEP 2: プロジェクトを選択 or 新規作成

STEP 3: Gmail API を有効化
  「APIとサービス」→「ライブラリ」→「Gmail API」→「有効にする」

STEP 4: OAuth 同意画面の設定
  「APIとサービス」→「OAuth 同意画面」
  → 種類: 外部 → アプリ名を入力 → テストユーザーに自分のメールを追加

STEP 5: 認証情報の作成
  「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」
  → アプリの種類: ウェブアプリケーション
  → 承認済みのリダイレクト URI に追加:
      http://localhost:4242
  → 作成 → クライアント ID と シークレットをコピー
${line()}
`);

  const envPath = '.env';
  const envMap = await readEnvFile(envPath);

  let clientId = envMap.get('GOOGLE_CLIENT_ID') ?? process.env.GOOGLE_CLIENT_ID ?? '';
  let clientSecret = envMap.get('GOOGLE_CLIENT_SECRET') ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
  let userEmail = envMap.get('GMAIL_USER_EMAIL') ?? process.env.GMAIL_USER_EMAIL ?? '';

  if (clientId) {
    console.log(`  既存の Client ID が見つかりました: ${clientId.slice(0, 20)}...`);
    const reuse = await ask('  そのまま使いますか？ [y/n]: ');
    if (reuse.trim().toLowerCase() !== 'y') clientId = '';
  }

  if (!clientId) {
    clientId = (await ask('  Google Client ID を貼り付けてください: ')).trim();
  }

  if (clientSecret) {
    console.log(`  既存の Client Secret が見つかりました: ${clientSecret.slice(0, 6)}...`);
    const reuse = await ask('  そのまま使いますか？ [y/n]: ');
    if (reuse.trim().toLowerCase() !== 'y') clientSecret = '';
  }

  if (!clientSecret) {
    clientSecret = (await ask('  Google Client Secret を貼り付けてください: ')).trim();
  }

  if (!userEmail) {
    userEmail = (await ask('  Gmailアドレスを入力してください（例: you@gmail.com）: ')).trim();
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });

  console.log(`
${line()}
以下のURLをブラウザで開いて、Googleアカウントにログインしてください:

  ${authUrl}

ブラウザで「許可」をクリックすると、このターミナルが自動で続きを処理します。
${line()}
`);

  let code: string;
  try {
    code = await waitForCodeViaLocalServer();
    console.log('  認証コードを受け取りました。');
  } catch {
    console.log('\n  ローカルサーバーで取得できませんでした。');
    console.log('  ブラウザに表示されたコードを手動で貼り付けてください:');
    code = (await ask('  認証コード: ')).trim();
  }

  console.log('\n  Refresh Token を取得中...');
  const { tokens } = await auth.getToken(code);
  const refreshToken = tokens.refresh_token;

  if (!refreshToken) {
    console.error('\n  ❌ Refresh Token が取得できませんでした。');
    console.error('  Google Cloud Console で「再同意を求める(prompt=consent)」を確認し、もう一度お試しください。');
    rl.close();
    process.exit(1);
  }

  const updates = new Map([
    ['GOOGLE_CLIENT_ID', clientId],
    ['GOOGLE_CLIENT_SECRET', clientSecret],
    ['GOOGLE_REFRESH_TOKEN', refreshToken],
    ['GMAIL_USER_EMAIL', userEmail],
    ['SCHEDULER_ENABLED', envMap.get('SCHEDULER_ENABLED') ?? 'false']
  ]);

  await writeEnvFile(envPath, updates);

  console.log(`
${line('═')}
✅ 設定完了！ .env ファイルに以下が書き込まれました:

  GOOGLE_CLIENT_ID     = ${clientId.slice(0, 20)}...
  GOOGLE_CLIENT_SECRET = ${clientSecret.slice(0, 6)}...
  GOOGLE_REFRESH_TOKEN = ${refreshToken.slice(0, 20)}...
  GMAIL_USER_EMAIL     = ${userEmail}

次のステップ:
  1. スケジューラーを有効にする場合は .env の SCHEDULER_ENABLED=true に変更
  2. npm run dev  →  サーバー起動（SCHEDULERがtrue なら自動でcron起動）
  3. 今すぐアラートを試す:
       curl -X POST http://localhost:8787/jobs/email-alert \\
            -H "Content-Type: application/json" \\
            -d '{"slot":"morning"}'
${line('═')}
`);

  rl.close();
}

main().catch((err) => {
  console.error('エラー:', err);
  rl.close();
  process.exit(1);
});
