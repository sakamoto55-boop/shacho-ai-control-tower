import 'dotenv/config';
/**
 * Gmail OAuth認可ヘルパー（1回だけ・gmail.readonlyのみ・送信権限なし）。
 * 使い方: npm run gmail:authorize → 表示URLをPCブラウザで開き承認 → 自動でtoken保存。
 * tokenは値を画面・ログへ出さない（GMAIL_TOKEN_FILEへ原子保存）。
 */
import { createServer } from 'node:http';
import { GmailClient, loadGmailConfig, resolveGmailAuthState } from '../src/command/integrations/gmail/gmailClient.js';

const config = loadGmailConfig('.');
const state = resolveGmailAuthState(config);
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
  try {
    await client.exchangeCode(code);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<h2>Gmail認可が完了しました（読取のみ）。この画面は閉じて構いません。</h2>');
    console.log('[gmail] token保存完了。npm run subscribers で購読を開始できます');
  } catch {
    res.writeHead(500).end('token交換に失敗しました');
    console.error('[gmail] token交換に失敗しました');
  } finally {
    setTimeout(() => { server.close(); process.exit(0); }, 500);
  }
});
server.listen(Number(url.port || 80), '127.0.0.1', () => {
  console.log('[gmail] 次のURLをブラウザで開いて承認してください（scope: gmail.readonly のみ）:');
  console.log(state.state === 'AUTH_REQUIRED' ? state.authorizeUrl : '');
});
