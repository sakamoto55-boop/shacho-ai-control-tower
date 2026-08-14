/**
 * 耐久確保コア（純関数・依存ゼロ）。
 *
 * 前提: LINE WORKSはCallback失敗時に再送しない。受理した1リクエストはここで必ず耐久化する。
 * 1) publishを内部で再試行（既定3回・指数backoff）
 * 2) それでも失敗したら耐久outbox（GCS等）へ保存 → 後続処理（LCC側drain）が必ず取り込む
 * 3) publish・outboxの両方が失敗した場合のみFAILED（500）。この経路は監視対象の異常
 *
 * @param {object} deps
 * @param {() => Promise<void>} deps.publish   Pub/Subへの発行（失敗はthrow）
 * @param {() => Promise<void>} [deps.outbox]  耐久outboxへの保存（未設定なら省略）
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {number} [deps.maxAttempts]
 * @param {number} [deps.baseBackoffMs]
 * @returns {Promise<{ outcome: 'PUBLISHED' | 'OUTBOXED' | 'FAILED'; publishAttempts: number; lastError: string | null }>}
 */
export async function captureDurably(deps) {
  const maxAttempts = deps.maxAttempts ?? 3;
  const base = deps.baseBackoffMs ?? 200;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await deps.publish();
      return { outcome: 'PUBLISHED', publishAttempts: attempt, lastError: null };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < maxAttempts) await sleep(base * 2 ** (attempt - 1));
    }
  }
  if (deps.outbox) {
    try {
      await deps.outbox();
      return { outcome: 'OUTBOXED', publishAttempts: maxAttempts, lastError };
    } catch (e) {
      lastError = `${lastError} / outbox: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    lastError = `${lastError} / outbox: NOT_CONFIGURED`;
  }
  return { outcome: 'FAILED', publishAttempts: maxAttempts, lastError };
}
