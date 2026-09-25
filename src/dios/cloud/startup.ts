import type { DiosDatabase } from './database.js';

const TRANSIENT_CONNECTION_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
  'EAI_AGAIN', 'ENOENT', '57P03',
]);
const ATTEMPTS = 19;
const RETRY_DELAY_MS = 5000;

function isTransientConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && TRANSIENT_CONNECTION_CODES.has(String(error.code))) return true;
  // pg-pool's connectionTimeoutMillis error has no code. Match only its fixed text.
  return error.message === 'Connection terminated due to connection timeout'
    || error.message === 'timeout exceeded when trying to connect';
}

/** Direct VPC/proxy startup may lag the container. Never serve before all DB checks pass. */
export async function verifyDatabaseAtStartup(db: Pick<DiosDatabase, 'verifyRuntimeRole'>): Promise<void> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await db.verifyRuntimeRole();
      return;
    } catch (error) {
      // Configuration, authentication, schema and RLS failures remain fail-closed.
      if (!isTransientConnectionError(error) || attempt === ATTEMPTS) throw error;
      await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
