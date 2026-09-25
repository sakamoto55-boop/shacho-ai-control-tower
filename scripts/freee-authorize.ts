import 'dotenv/config';
/**
 * freee OAuth認可ヘルパー（夜間統合運転 §11）。
 * 実行すると認可URLを表示し、localhostで認可コードを1回だけ受けてtokenへ交換・保存する。
 * 使い方: npx tsx scripts/freee-authorize.ts
 * 注意: tokenはsecure/freee-tokens.json（Git外）。値は画面・ログへ出さない。
 */
import { createServer } from 'node:http';
import { FreeeClient, loadFreeeConfig, resolveAuthState } from '../src/command/integrations/freee/freeeClient.js';
import { createFreeeAuthorizationHandler, FREEE_AUTH_TIMEOUT_MS } from '../src/command/integrations/freee/freeeAuthorization.js';

const config = loadFreeeConfig('.');
const state = resolveAuthState(config);

if (state.state === 'ADMIN_SETUP_REQUIRED') {
  console.error(`[freee] ${state.reason}`);
  console.error('[freee] 既存のLCC COMMAND連携の管理者・設定保存先を確認してください。未設定を理由にアプリを重複作成しないでください。');
  process.exit(2);
}
if (state.state === 'READY') {
  console.log('[freee] 保存済みtokenがあります（有効性・対象事業所・権限のAPI検証は別途必要です）。');
  process.exit(0);
}

const url = new URL(config.redirectUri);
const port = Number(url.port || 80);
const client = new FreeeClient(config);

const server = createServer(createFreeeAuthorizationHandler({
  redirectUri: config.redirectUri,
  state: state.oauthState,
  exchangeCode: (code) => client.exchangeCode(code),
  finished: (success) => {
    clearTimeout(timeout);
    console.log(success
      ? '[freee] token保存完了。実データ同期の前に対象事業所・取得範囲・保存先を確認してください。'
      : '[freee] 認可は完了していません。再実行してください。');
    process.exitCode = success ? 0 : 1;
    server.close();
  }
}));
const timeout = setTimeout(() => {
  console.error('[freee] 認可の待機時間を超えました。再実行してください。');
  server.close();
  server.closeAllConnections();
  process.exitCode = 1;
}, FREEE_AUTH_TIMEOUT_MS);
server.on('error', () => {
  clearTimeout(timeout);
  console.error('[freee] localhostの認可受付を開始できませんでした。');
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log('[freee] ブラウザで次のURLを開いて承認してください（1回だけ有効）:');
  console.log(state.state === 'AUTH_REQUIRED' ? state.authorizeUrl : '');
  console.log(`[freee] callback待機中: ${config.redirectUri}`);
});
