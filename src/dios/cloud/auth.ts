import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { Principal } from '../../command/domain/types.js';
import { DiosDatabase } from './database.js';

export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const validSecret = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
export interface OidcConfig { origin: string; clientId: string; clientSecret: string }
export interface Identity { sub: string; email: string }
export interface CodeExchange { exchange(code: string, nonce: string, verifier: string): Promise<Identity> }
export function readOidcConfig(env: NodeJS.ProcessEnv): OidcConfig {
  const { DIOS_PUBLIC_ORIGIN: origin, DIOS_GOOGLE_CLIENT_ID: clientId, DIOS_GOOGLE_CLIENT_SECRET: clientSecret } = env;
  if (!origin || !clientId || !clientSecret) throw new Error('DIOS_OIDC_CONFIG_REQUIRED');
  const u = new URL(origin);
  if (u.protocol !== 'https:' || u.origin !== origin || u.username || u.password) throw new Error('DIOS_HTTPS_ORIGIN_REQUIRED');
  return { origin, clientId, clientSecret };
}
export function validateClaims(p: JWTPayload, clientId: string, nonce: string): Identity {
  if (p.aud !== clientId || (p.azp !== undefined && p.azp !== clientId) || p.nonce !== nonce ||
      p.email_verified !== true || typeof p.sub !== 'string' || !p.sub || p.sub.length>255 ||
      typeof p.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(p.email) ||
      !['accounts.google.com','https://accounts.google.com'].includes(String(p.iss)) ||
      typeof p.exp !== 'number' || p.exp <= Date.now()/1000) throw new Error('DIOS_IDENTITY_REJECTED');
  return { sub:p.sub, email:p.email.toLowerCase() };
}
export class GoogleCodeExchange implements CodeExchange {
  private readonly jwks: JWTVerifyGetKey;
  constructor(private readonly config: OidcConfig, private readonly fetcher: typeof fetch = fetch, key?: JWTVerifyGetKey) {
    this.jwks = key ?? createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { timeoutDuration:5000 });
  }
  async exchange(code: string, nonce: string, verifier: string): Promise<Identity> {
    const res = await this.fetcher('https://oauth2.googleapis.com/token', {
      method:'POST', signal:AbortSignal.timeout(10000), redirect:'error',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({code, client_id:this.config.clientId, client_secret:this.config.clientSecret,
        redirect_uri:this.config.origin+'/dios/auth/callback', grant_type:'authorization_code', code_verifier:verifier})
    });
    if (!res.ok) throw new Error('DIOS_OIDC_EXCHANGE_FAILED');
    const b = await res.json() as { id_token?: unknown };
    if (typeof b.id_token !== 'string') throw new Error('DIOS_OIDC_TOKEN_MISSING');
    const { payload } = await jwtVerify(b.id_token,this.jwks,{ algorithms:['RS256'], audience:this.config.clientId,
      issuer:['https://accounts.google.com','accounts.google.com'], requiredClaims:['exp','iat','sub','nonce','email','email_verified'], maxTokenAge:'10m' });
    return validateClaims(payload,this.config.clientId,nonce);
  }
}
export interface Session { email:string; sub:string; principal:Principal }
export class CloudSessions {
  constructor(readonly db: DiosDatabase, readonly config: OidcConfig, private readonly oidc: CodeExchange) {}
  async begin(): Promise<{ url:string; binding:string }> {
    const state=secret(),binding=secret(),nonce=secret(),verifier=secret();
    await this.db.transaction(async () => {
      await this.db.query('DELETE FROM dios_oauth_states WHERE tenant_id=$1 AND expires_at<=now()',[this.db.tenantId]);
      await this.db.query('INSERT INTO dios_oauth_states(tenant_id,state_hash,binding_hash,nonce,verifier,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'10 minutes\')',
        [this.db.tenantId,digest(state),digest(binding),nonce,verifier]);
    });
    const p=new URLSearchParams({client_id:this.config.clientId,redirect_uri:this.config.origin+'/dios/auth/callback',
      response_type:'code',scope:'openid email',state,nonce,prompt:'select_account',
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return { url:'https://accounts.google.com/o/oauth2/v2/auth?'+p.toString(), binding };
  }
  async finish(code: string, state: string, binding: string): Promise<string> {
    if (!code || code.length>4096 || !validSecret(state) || !validSecret(binding)) throw new Error('DIOS_OIDC_STATE_REJECTED');
    const r = await this.db.query<{nonce:string;verifier:string}>(
      'DELETE FROM dios_oauth_states WHERE tenant_id=$1 AND state_hash=$2 AND binding_hash=$3 AND expires_at>now() RETURNING nonce,verifier',
      [this.db.tenantId,digest(state),digest(binding)]);
    if (r.rowCount!==1) throw new Error('DIOS_OIDC_STATE_REJECTED');
    const identity=await this.oidc.exchange(code,r.rows[0].nonce,r.rows[0].verifier);
    return this.db.transaction(async () => {
      const m = await this.db.query<{ google_sub:string|null; auth_version:number; principal:Principal }>(
        'SELECT google_sub,auth_version,principal FROM dios_members WHERE tenant_id=$1 AND email=$2 AND active=true FOR UPDATE',[this.db.tenantId,identity.email]);
      if (m.rowCount!==1 || (m.rows[0].google_sub && m.rows[0].google_sub!==identity.sub)) throw new Error('DIOS_MEMBER_NOT_ALLOWED');
      if (m.rows[0].principal.role!=='PRESIDENT') throw new Error('DIOS_PILOT_OWNER_ONLY');
      await this.db.query('UPDATE dios_members SET google_sub=$3 WHERE tenant_id=$1 AND email=$2',[this.db.tenantId,identity.email,identity.sub]);
      const token=secret();
      await this.db.query('INSERT INTO dios_sessions(tenant_id,token_hash,email,google_sub,auth_version,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'12 hours\')',
        [this.db.tenantId,digest(token),identity.email,identity.sub,m.rows[0].auth_version]);
      await this.db.query('INSERT INTO dios_audit(tenant_id,entry) VALUES($1,$2::jsonb)',[this.db.tenantId,JSON.stringify({action:'login',actor:identity.sub})]);
      return token;
    });
  }
  async resolve(token: string | undefined): Promise<Session|null> {
    if (!validSecret(token)) return null;
    const r=await this.db.query<{email:string; google_sub:string; principal:Principal}>(
      `SELECT s.email,s.google_sub,m.principal FROM dios_sessions s JOIN dios_members m ON s.tenant_id=m.tenant_id AND s.email=m.email
       WHERE s.tenant_id=$1 AND s.token_hash=$2 AND s.expires_at>now() AND m.active=true AND m.auth_version=s.auth_version AND m.google_sub=s.google_sub`,[this.db.tenantId,digest(token)]);
    const row=r.rows[0];
    if (!row || row.principal.role!=='PRESIDENT' || !Array.isArray(row.principal.companyIds)) return null;
    return {email:row.email,sub:row.google_sub,principal:{...row.principal,label:row.email}};
  }
  async logout(token: string|undefined): Promise<void> {
    if (validSecret(token)) await this.db.query('DELETE FROM dios_sessions WHERE tenant_id=$1 AND token_hash=$2',[this.db.tenantId,digest(token)]);
  }
  async revokeAll(session:Session): Promise<void> {
    await this.db.transaction(async()=>{
      await this.db.query('UPDATE dios_members SET auth_version=auth_version+1 WHERE tenant_id=$1 AND email=$2',[this.db.tenantId,session.email]);
      await this.db.query('DELETE FROM dios_sessions WHERE tenant_id=$1 AND email=$2',[this.db.tenantId,session.email]);
      await this.db.query('INSERT INTO dios_audit(tenant_id,entry) VALUES($1,$2::jsonb)',[this.db.tenantId,JSON.stringify({action:'sessions.revoked',actor:session.sub})]);
    });
  }
  async allowRate(key:string,limit=60):Promise<boolean> {
    const r=await this.db.query<{hits:number}>(`INSERT INTO dios_rate_limits(tenant_id,rate_key,window_start,hits)
      VALUES($1,$2,floor(extract(epoch from now())/60),1)
      ON CONFLICT(tenant_id,rate_key) DO UPDATE SET
      hits=CASE WHEN dios_rate_limits.window_start=EXCLUDED.window_start THEN dios_rate_limits.hits+1 ELSE 1 END,window_start=EXCLUDED.window_start RETURNING hits`,[this.db.tenantId,digest(key)]);
    return r.rows[0].hits<=limit;
  }
}
export const SESSION_COOKIE='__Host-dios_session';
export const STATE_COOKIE='__Host-dios_oauth';
export function cookieValue(raw:string|undefined,name:string):string|undefined {
  const entries=(raw??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
  if (entries.length!==1) return undefined;
  const token=entries[0].slice(name.length+1);return validSecret(token)?token:undefined;
}
export function secureCookie(name:string,value:string,seconds:number):string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${seconds}`;
}
