import type { CommandRepository, CommandStore } from '../../command/repositories/CommandRepository.js';
import type { SourceRegistry } from '../../command/sources/SourceAdapter.js';
import type { ApprovalRequest } from '../../command/domain/types.js';
import { isDeepStrictEqual } from 'node:util';
import { DiosDatabase } from './database.js';

const ids: Record<keyof CommandStore, string> = {
  decisions:'decisionId', tasks:'taskId', approvals:'approvalId', research:'researchId', memories:'memoryId',
  experiments:'experimentId', targets:'targetId', principles:'principleId', artifacts:'artifactId', growthItems:'', incidents:'incidentId'
};
export function emptyStore(): CommandStore {
  return { decisions:[], tasks:[], approvals:[], research:[], memories:[], experiments:[], targets:[], principles:[], artifacts:[], growthItems:[], incidents:[] };
}
/** Existing business services/MemoryService retain validation; only persistence is exchanged. */
export class PostgresCommandRepository implements CommandRepository {
  readonly mode = 'production' as const;
  constructor(readonly db: DiosDatabase, private readonly sources: SourceRegistry) {
    if (sources.mode !== 'production') throw new Error('DIOS_CLOUD_DEMO_SOURCE_REJECTED');
  }
  getDataset(asOf: string) { return this.sources.compose(asOf); }
  async getStore(): Promise<CommandStore> {
    const result = emptyStore();
    const r = await this.db.query<{ bucket: keyof CommandStore; document: never }>(
      'SELECT bucket,document FROM dios_records WHERE tenant_id=$1 AND bucket=ANY($2::text[]) ORDER BY bucket,record_id', [this.db.tenantId, Object.keys(ids)]);
    for (const row of r.rows) if (Object.hasOwn(result, row.bucket)) result[row.bucket].push(row.document);
    return result;
  }
  private async list<K extends keyof CommandStore>(bucket: K): Promise<CommandStore[K]> {
    const r = await this.db.query<{ document: never }>('SELECT document FROM dios_records WHERE tenant_id=$1 AND bucket=$2 ORDER BY record_id', [this.db.tenantId,bucket]);
    return r.rows.map(r => r.document) as CommandStore[K];
  }
  private async save<K extends keyof CommandStore>(bucket: K, record: CommandStore[K][number]): Promise<CommandStore[K][number]> {
    const obj = record as unknown as Record<string, unknown>;
    const field = bucket === 'growthItems' ? ['candidateId','improvementId','repairId','mappingId'].find(k => typeof obj[k] === 'string') : ids[bucket];
    const id = field ? obj[field] : undefined;
    if (typeof id !== 'string' || !id || id.length > 256) throw new Error('DIOS_INVALID_RECORD_ID');
    const json = JSON.stringify(record);
    if (Buffer.byteLength(json) > 1024*1024) throw new Error('DIOS_RECORD_TOO_LARGE');
    await this.db.query(`INSERT INTO dios_records(tenant_id,bucket,record_id,document) VALUES($1,$2,$3,$4::jsonb)
      ON CONFLICT(tenant_id,bucket,record_id) DO UPDATE SET document=EXCLUDED.document
      WHERE dios_records.document IS DISTINCT FROM EXCLUDED.document`, [this.db.tenantId,bucket,id,json]);
    return record;
  }
  saveDecision(r: CommandStore['decisions'][number]) { return this.save('decisions',r); }
  saveTask(r: CommandStore['tasks'][number]) { return this.save('tasks',r); }
  async saveApproval(r: ApprovalRequest): Promise<ApprovalRequest> {
    return this.db.transaction(async()=>{
      const existing=(await this.list('approvals')).find(a=>a.approvalId===r.approvalId);
      if(existing){ if(!isDeepStrictEqual(existing,r))throw new Error('DIOS_APPROVAL_PAYLOAD_IMMUTABLE');return existing; }
      if(r.status!=='waiting')throw new Error('DIOS_APPROVAL_STATE');
      return this.save('approvals',r);
    });
  }
  async updateApproval(id: string, patch: Partial<ApprovalRequest>): Promise<ApprovalRequest|null> {
    return this.db.transaction(async () => {
      const current = (await this.list('approvals')).find(r => r.approvalId === id);
      if (!current) return null;
      if (current.status !== 'waiting') return current;
      const allowed = new Set(['status','decidedAt','executionResult']);
      if (Object.keys(patch).some(k => !allowed.has(k))) throw new Error('DIOS_APPROVAL_PAYLOAD_IMMUTABLE');
      if (patch.status && !['approved','rejected','executed_dry_run'].includes(patch.status)) throw new Error('DIOS_APPROVAL_STATE');
      return this.save('approvals', { ...current,...patch });
    });
  }
  saveResearch(r: CommandStore['research'][number]) { return this.save('research',r); }
  getMemories() { return this.list('memories'); }
  saveMemory(r: CommandStore['memories'][number]) { return this.save('memories',r); }
  getExperiments() { return this.list('experiments'); }
  saveExperiment(r: CommandStore['experiments'][number]) { return this.save('experiments',r); }
  getTargets() { return this.list('targets'); }
  saveTarget(r: CommandStore['targets'][number]) { return this.save('targets',r); }
  getPrinciples() { return this.list('principles'); }
  savePrinciple(r: CommandStore['principles'][number]) { return this.save('principles',r); }
  getArtifacts() { return this.list('artifacts'); }
  saveArtifact(r: CommandStore['artifacts'][number]) { return this.save('artifacts',r); }
  getGrowthItems() { return this.list('growthItems'); }
  saveGrowthItem(r: CommandStore['growthItems'][number]) { return this.save('growthItems',r); }
  getIncidents() { return this.list('incidents'); }
  saveIncident(r: CommandStore['incidents'][number]) { return this.save('incidents',r); }
}
