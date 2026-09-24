import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const FREEE_AUTH_TIMEOUT_MS = 10 * 60_000;

/** Only the local, single-use flow started by this process may exchange a code. */
export function createFreeeAuthorizationHandler(options: {
  redirectUri: string;
  state: string;
  exchangeCode: (code: string) => Promise<void>;
  finished: (success: boolean) => void;
  now?: () => number;
}) {
  const callback = new URL(options.redirectUri);
  if (
    callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' ||
    callback.username || callback.password || callback.search || callback.hash || !options.state
  ) {
    throw new Error('freee callbackは http://127.0.0.1 のクエリなしURLで指定してください');
  }
  const now = options.now ?? Date.now;
  const deadline = now() + FREEE_AUTH_TIMEOUT_MS;
  const expected = Buffer.from(options.state);
  let consumed = false;
  return async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, message: string) => {
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer'
      }).end(message);
    };
    let url: URL;
    try { url = new URL(req.url ?? '/', callback); }
    catch { reply(400, '不正なリクエストです'); return; }
    if (url.origin !== callback.origin || req.headers.host !== callback.host || url.pathname !== callback.pathname) {
      reply(404, '対象外のリクエストです'); return;
    }
    if (req.method !== 'GET') { reply(405, 'GETのみ受け付けます'); return; }
    if (consumed || now() >= deadline) { reply(410, '認可受付は終了しています。再実行してください'); return; }
    const states = url.searchParams.getAll('state');
    const received = Buffer.from(states[0] ?? '');
    if (states.length !== 1 || received.length !== expected.length || !timingSafeEqual(received, expected)) {
      reply(400, '認可の照合に失敗しました'); return;
    }
    if (url.searchParams.has('error')) {
      consumed = true;
      reply(400, 'freeeでの認可が完了していません');
      options.finished(false);
      return;
    }
    const codes = url.searchParams.getAll('code');
    if (codes.length !== 1 || !codes[0]) { reply(400, '認可コードがありません'); return; }
    // Consume before awaiting the exchange so simultaneous/replayed callbacks cannot overwrite tokens.
    consumed = true;
    let success = false;
    try {
      await options.exchangeCode(codes[0]);
      success = true;
      reply(200, 'freee認可が完了しました。この画面は閉じて構いません。');
    } catch {
      reply(500, 'token交換に失敗しました。認可から再実行してください');
    }
    options.finished(success);
  };
}
