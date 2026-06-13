#!/usr/bin/env tsx
/**
 * LINE WORKS Bot API v2 セットアップ確認スクリプト
 * usage: npm run setup:lineworks
 */
import 'dotenv/config';
import { createSign } from 'node:crypto';

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const REQUIRED = [
  'LINEWORKS_BOT_ID',
  'LINEWORKS_CLIENT_ID',
  'LINEWORKS_CLIENT_SECRET',
  'LINEWORKS_SERVICE_ACCOUNT',
  'LINEWORKS_PRIVATE_KEY',
  'LINEWORKS_REPORT_ROOM_ID'
] as const;

function check() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('\n❌ 未設定の環境変数があります:');
    missing.forEach((k) => console.error(`   ${k}`));
    console.error('\n.env ファイルに設定してから再実行してください。');
    console.error(
      '秘密鍵 PEM は改行を \\n に置換して 1 行で設定してください。\n例:\n  LINEWORKS_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nMII...\\n-----END RSA PRIVATE KEY-----\n'
    );
    process.exit(1);
  }
  console.log('✅ 環境変数: 全項目設定済み');
}

async function testJwt(): Promise<string> {
  const clientId = process.env.LINEWORKS_CLIENT_ID!;
  const serviceAccount = process.env.LINEWORKS_SERVICE_ACCOUNT!;
  const privateKeyPem = process.env.LINEWORKS_PRIVATE_KEY!.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 3600 })
  );
  const signingInput = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = base64url(sign.sign(privateKeyPem));
  const jwt = `${signingInput}.${signature}`;
  console.log('✅ JWT 生成: 成功');
  return jwt;
}

async function testToken(jwt: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
    client_id: process.env.LINEWORKS_CLIENT_ID!,
    client_secret: process.env.LINEWORKS_CLIENT_SECRET!,
    scope: 'bot'
  });
  const res = await fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    console.error('❌ アクセストークン取得失敗:');
    console.error(`   ${JSON.stringify(json)}`);
    process.exit(1);
  }
  console.log('✅ アクセストークン取得: 成功');
  return json.access_token;
}

async function testSend(token: string): Promise<void> {
  const botId = process.env.LINEWORKS_BOT_ID!;
  const channelId = process.env.LINEWORKS_REPORT_ROOM_ID!;
  const url = `https://www.worksapis.com/v1.0/bots/${botId}/channels/${channelId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: {
        type: 'text',
        text: '✅ 社長AI管制塔 — LINE WORKS 接続テスト成功\nアラート通知が届くようになりました。'
      }
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`❌ メッセージ送信失敗: HTTP ${res.status}`);
    console.error(`   ${detail}`);
    console.error('\n確認事項:');
    console.error('  - LINEWORKS_BOT_ID が正しいか');
    console.error('  - LINEWORKS_REPORT_ROOM_ID が正しいか（トークルームURLの末尾の数字）');
    console.error('  - Bot がそのトークルームに招待されているか');
    process.exit(1);
  }
  console.log('✅ テストメッセージ送信: 成功');
  console.log('\nLINE WORKS のトークルームを確認してください。');
  console.log('届いていれば .env の LINEWORKS_DRY_RUN=false を設定して完了です。');
}

async function main() {
  console.log('\n=== LINE WORKS Bot API v2 セットアップ確認 ===\n');
  check();
  const jwt = await testJwt();
  const token = await testToken(jwt);
  await testSend(token);
  console.log('\n=== 完了 ===\n');
}

main().catch((err) => {
  console.error('\n予期しないエラー:', err);
  process.exit(1);
});
