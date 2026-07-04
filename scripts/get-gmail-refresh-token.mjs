#!/usr/bin/env node
/**
 * Gmail連携用のリフレッシュトークンをローカルで取得するスクリプト。
 * OAuth Playground経由と違い、指定したクライアントID/シークレットに
 * 確実に紐づくトークンが得られる（ブラウザでの1回のログイン許可だけで完結）。
 *
 * 使い方:
 *   node scripts/get-gmail-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
 */
import http from 'node:http';

const [, , clientId, clientSecret] = process.argv;

if (!clientId || !clientSecret) {
  console.error('使い方: node scripts/get-gmail-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const port = 53682;
const redirectUri = `http://localhost:${port}`;
const scope = 'https://www.googleapis.com/auth/gmail.readonly';

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', scope);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirectUri);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>エラー: ${error}</h1>`);
    console.error(`\n認証エラー: ${error}\n`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400);
    res.end('code not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>認証できました。このタブは閉じてターミナルに戻ってください。</h1>');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const data = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('\nトークン交換に失敗しました:', data);
      process.exit(1);
    }

    if (!data.refresh_token) {
      console.error(
        '\nrefresh_tokenが返ってきませんでした。既にこのアプリを許可済みだと発行されないことがあります。' +
          'Googleアカウントの「サードパーティ製アプリのアクセス権」からこのアプリの接続を一度解除してから、もう一度実行してください。'
      );
      process.exit(1);
    }

    console.log('\n=== 以下をCloud Runの環境変数に設定してください ===');
    console.log(`GOOGLE_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}`);
    console.log('====================================================\n');
  } finally {
    server.close();
  }
});

server.listen(port, () => {
  console.log('\n以下のURLをブラウザで開いてログイン・許可してください:\n');
  console.log(authUrl.toString());
  console.log('\n許可すると、このターミナルに結果が表示されます...\n');
});
