import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';

/** A deployment owns one tenant. Tenant identity is server configuration, never an HTTP field. */
export class DiosDatabase {
  private readonly context = new AsyncLocalStorage<{ client: PoolClient; writable: boolean; active: boolean }>();
  constructor(readonly pool: Pool, readonly tenantId: string) {
    if (!/^[a-z0-9_-]{1,64}$/.test(tenantId)) throw new Error('DIOS_INVALID_TENANT');
  }
  async verifyRuntimeRole(): Promise<void> {
    const r = await this.pool.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean }>(
      'SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user');
    if (!r.rows[0] || r.rows[0].rolsuper || r.rows[0].rolbypassrls || r.rows[0].rolcreaterole) throw new Error('DIOS_UNSAFE_DATABASE_ROLE');
    const binding = await this.pool.query('SELECT tenant_id FROM dios_tenant_roles WHERE role_name=current_user AND tenant_id=$1',[this.tenantId]);
    if(binding.rowCount!==1)throw new Error('DIOS_DATABASE_TENANT_NOT_BOUND');
    const owner = await this.pool.query("SELECT 1 FROM pg_class WHERE oid='dios_records'::regclass AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)");
    if(owner.rowCount)throw new Error('DIOS_DATABASE_OWNER_NOT_RUNTIME');
    const schema = await this.pool.query('SELECT version FROM dios_schema_versions WHERE version=1');
    if (schema.rowCount !== 1) throw new Error('DIOS_SCHEMA_NOT_READY');
    const tables = await this.pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('dios_records'::regclass,'dios_revisions'::regclass,'dios_audit'::regclass,'dios_sessions'::regclass,'dios_members'::regclass,'dios_oauth_states'::regclass,'dios_rate_limits'::regclass)");
    if (tables.rows.length !== 7 || tables.rows.some(r => !r.relrowsecurity || !r.relforcerowsecurity)) throw new Error('DIOS_RLS_NOT_READY');
  }
  /** Same connection for BEGIN, all queries, and COMMIT. Multi-record memory corrections are atomic. */
  async transaction<T>(fn: () => Promise<T>, writable = true): Promise<T> {
    const parent = this.context.getStore();
    if (parent) {
      if (!parent.active || (writable && !parent.writable)) throw new Error('DIOS_INVALID_TRANSACTION_CONTEXT');
      return fn();
    }
    const client = await this.pool.connect();
    const ctx = { client, writable, active: true };
    try {
      await client.query(writable ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SELECT set_config('dios.tenant_id',$1,true)", [this.tenantId]);
      if (writable) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ['dios:' + this.tenantId]);
      const result = await this.context.run(ctx, fn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      ctx.active = false;
      client.release();
    }
  }
  query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    const ctx = this.context.getStore();
    if (ctx) {
      if (!ctx.active) return Promise.reject(new Error('DIOS_TRANSACTION_ALREADY_FINISHED'));
      return ctx.client.query<T>(text, values);
    }
    return this.transaction(() => this.query<T>(text, values));
  }
  async close(): Promise<void> { await this.pool.end(); }
}

/** No rejectUnauthorized=false, silent TLS downgrade, or logging credential URLs. */
export function databaseConfig(env: NodeJS.ProcessEnv): PoolConfig {
  const raw = env.DIOS_DATABASE_URL;
  if (!raw) throw new Error('DIOS_DATABASE_URL_REQUIRED');
  const u = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw new Error('DIOS_DATABASE_PROTOCOL');
  if (u.search || u.hash || !u.username || !u.pathname.slice(1)) throw new Error('DIOS_DATABASE_QUERY_OPTIONS_NOT_ALLOWED');
  const mode = env.DIOS_DATABASE_TRANSPORT ?? 'tls';
  const local = ['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if (mode === 'local-test' && (!local || env.NODE_ENV !== 'test' || env.K_SERVICE)) throw new Error('DIOS_PLAINTEXT_DATABASE_REJECTED');
  if (!['tls','local-test','cloudsql-socket'].includes(mode)) throw new Error('DIOS_DATABASE_TRANSPORT');
  // Parse explicitly: connectionString can otherwise override the Unix socket host.
  const config: PoolConfig = { host:u.hostname, port:u.port ? Number(u.port) : 5432,
    user:decodeURIComponent(u.username), password:decodeURIComponent(u.password), database:decodeURIComponent(u.pathname.slice(1)),
    max:5, connectionTimeoutMillis:5000, idleTimeoutMillis:10000, statement_timeout:60000 };
  if (mode === 'tls') config.ssl = { rejectUnauthorized: true, ...(env.DIOS_DATABASE_CA_PEM ? { ca: env.DIOS_DATABASE_CA_PEM } : {}) };
  if (mode === 'cloudsql-socket') {
    const socket = env.DIOS_CLOUDSQL_SOCKET;
    if (!socket || !/^\/cloudsql\/[a-z][a-z0-9-]+:[a-z0-9-]+:[a-z][a-z0-9-]+$/.test(socket)) throw new Error('DIOS_CLOUDSQL_SOCKET_REQUIRED');
    config.host = socket; config.ssl = false;
  }
  return config;
}
