import 'dotenv/config';
/**
 * Gmail OAuth認可ヘルパー（1回だけ・gmail.readonlyのみ・送信権限なし）。
 * 使い方: npm run gmail:authorize → 表示URLをPCブラウザで開き承認 → 自動でtoken保存。
 * tokenは値を画面・ログへ出さない（GMAIL_TOKEN_FILEへ原子保存）。
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { GmailClient, loadGmailConfig, resolveGmailAuthState } from '../src/command/integrations/gmail/gmailClient.js';

const config = loadGmailConfig('.');
// OAuth state（CSRF対策）: 認可URLへ埋め込み、callbackで完全一致を検証する
const oauthState = randomBytes(16).toString('base64url');
const state = resolveGmailAuthState(config, oauthState);

// ロールバック用: npm run gmail:authorize -- --stop で watch を解除（token・メールへの影響なし）
if (process.argv.includes('--stop')) {
  if (state.state !== 'READY') {
    console.error('[gmail] 認可済みtokenがないため解除対象のwatchはありません');
    process.exit(2);
  }
  const c = new GmailClient(config);
  try {
    await c.stopWatch();
    console.log('[gmail] users.stop 完了（watch解除。再開は npm run subscribers）');
    process.exit(0);
  } catch (e) {
    console.error(`[gmail] watch解除に失敗: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
if (state.state === 'CONFIG_REQUIRED') {
  console.error(`[gmail] ${state.reason}`);
  process.exit(2);
}
if (state.state === 'READY') {
  console.log('[gmail] 既に認可済みです（token PRESENT）');
  process.exit(0);
}

const url = new URL(config.redirectUri);
const client = new GmailClient(config);
const server = createServer(async (req, res) => {
  const reqUrl = new URL(req.url ?? '/', config.redirectUri);
  if (reqUrl.pathname !== url.pathname) { res.writeHead(404).end(); return; }
  const code = reqUrl.searchParams.get('code');
  if (!code) { res.writeHead(400).end('認可コードがありません'); return; }
  if (reqUrl.searchParams.get('state') !== oauthState) {
    res.writeHead(400).end('state検証に失敗しました（CSRFの可能性）。もう一度 npm run gmail:authorize からやり直してください');
    console.error('[gmail] OAuth state不一致のため認可コードを拒否しました');
    setTimeout(() => { server.close(); process.exit(1); }, 500);
    return;
  }
  try {
    await client.exchangeCode(code);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<h2>Gmail認可が完了しました（読取のみ）。この画面は閉じて構いません。</h2>');
    console.log('[gmail] token保存完了。npm run subscribers で購読を開始できます');
    setTimeout(() => { server.close(); process.exit(0); }, 500);
  } catch {
    res.writeHead(500).end('token交換に失敗しました');
    console.error('[gmail] token交換に失敗しました');
    setTimeout(() => { server.close(); process.exit(1); }, 500); // 失敗はexit 1（成功と偽らない）
  }
});
server.listen(Number(url.port || 80), '127.0.0.1', () => {
  console.log('[gmail] 次のURLをブラウザで開いて承認してください（scope: gmail.readonly のみ）:');
  console.log(state.state === 'AUTH_REQUIRED' ? state.authorizeUrl : '');
});
