import 'dotenv/config';
/**
 * freee OAuth認可ヘルパー（夜間統合運転 §11）。
 * 実行すると認可URLを表示し、localhostで認可コードを1回だけ受けてtokenへ交換・保存する。
 * 使い方: npx tsx scripts/freee-authorize.ts
 * 注意: tokenはsecure/freee-tokens.json（Git外）。値は画面・ログへ出さない。
 */
import { createServer } from 'node:http';
import { FreeeClient, loadFreeeConfig, resolveAuthState } from '../src/command/integrations/freee/freeeClient.js';

const config = loadFreeeConfig('.');
const state = resolveAuthState(config);

if (state.state === 'ADMIN_SETUP_REQUIRED') {
  console.error(`[freee] ${state.reason}`);
  console.error('[freee] developer.freee.co.jp でアプリ登録し、.envへFREEE_CLIENT_ID/FREEE_CLIENT_SECRETを設定してください。');
  process.exit(2);
}
if (state.state === 'READY') {
  console.log('[freee] 既に認可済みです（secure/freee-tokens.json PRESENT）。');
  process.exit(0);
}

const url = new URL(config.redirectUri);
const port = Number(url.port || 80);
const client = new FreeeClient(config);

const server = createServer(async (req, res) => {
  const reqUrl = new URL(req.url ?? '/', config.redirectUri);
  if (reqUrl.pathname !== url.pathname) {
    res.writeHead(404).end();
    return;
  }
  const code = reqUrl.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('認可コードがありません');
    return;
  }
  try {
    await client.exchangeCode(code);
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<h2>freee認可が完了しました。この画面は閉じて構いません。</h2>');
    console.log('[freee] token保存完了（secure/freee-tokens.json）。npm run sync:freee で状態を確認できます。');
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('token交換に失敗しました');
    console.error('[freee] token交換に失敗しました（コードの再取得が必要です）');
  } finally {
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 500);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('[freee] ブラウザで次のURLを開いて承認してください（1回だけ有効）:');
  console.log(state.state === 'AUTH_REQUIRED' ? state.authorizeUrl : '');
  console.log(`[freee] callback待機中: ${config.redirectUri}`);
});
