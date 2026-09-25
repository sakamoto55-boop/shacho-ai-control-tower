import { createHash } from 'node:crypto';
import { AuditLog, type AuditEntry } from '../../command/security/audit.js';
import { emptyContext, type ConversationContext, type ConversationContextStore } from '../../command/orchestrator/context.js';
import { DiosDatabase } from './database.js';

export class PostgresAuditLog extends AuditLog {
  constructor(private readonly db: DiosDatabase) { super(''); }
  override async record(entry: Omit<AuditEntry,'timestamp'|'detail'> & { detail:string }):Promise<void> {
    const value={...entry, detail:'[content omitted]',timestamp:new Date().toISOString()};
    await this.db.query('INSERT INTO dios_audit(tenant_id,entry) VALUES($1,$2::jsonb)',[this.db.tenantId,JSON.stringify(value)]);
    await super.record(value);
  }
}
export class PostgresContextStore implements ConversationContextStore {
  constructor(private readonly db:DiosDatabase) {}
  private key(id:string) { return createHash('sha256').update(id).digest('hex'); }
  async get(id:string,scope:string):Promise<ConversationContext> {
    const r=await this.db.query<{document:ConversationContext}>(
      "SELECT document FROM dios_records WHERE tenant_id=$1 AND bucket='context' AND record_id=$2",[this.db.tenantId,this.key(id)]);
    const c=r.rows[0]?.document;
    return c && c.sessionId===id && Date.now()-c.updatedAtMs<30*60*1000 ? c : emptyContext(id,scope);
  }
  async save(context:ConversationContext):Promise<void> {
    context.updatedAtMs=Date.now();
    await this.db.query(`INSERT INTO dios_records(tenant_id,bucket,record_id,document) VALUES($1,'context',$2,$3::jsonb)
      ON CONFLICT(tenant_id,bucket,record_id) DO UPDATE SET document=EXCLUDED.document`,[this.db.tenantId,this.key(context.sessionId),JSON.stringify(context)]);
  }
}
