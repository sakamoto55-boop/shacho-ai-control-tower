import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {DiosDatabase} from '../../../src/dios/cloud/database.js';
import {PostgresCommandRepository} from '../../../src/dios/cloud/repository.js';
import {PostgresContextStore} from '../../../src/dios/cloud/state.js';
import {ProductionSourceRegistry,DemoSourceRegistry} from '../../../src/command/sources/SourceAdapter.js';
import {CloudSessions,SESSION_COOKIE} from '../../../src/dios/cloud/auth.js';
import {createCloudApp} from '../../../src/dios/cloud/app.js';
import {MemoryService,type NewMemoryInput} from '../../../src/command/memory/store.js';
import type {ApprovalRequest,CommandTask} from '../../../src/command/domain/types.js';
import {emptyContext} from '../../../src/command/orchestrator/context.js';
const adminUrl=process.env.DIOS_TEST_DATABASE_URL;
if(process.env.DIOS_CLOUD_TEST_REQUIRED==='true'&&!adminUrl)throw new Error('REAL_POSTGRES_REQUIRED');
const config={origin:'https://dios.example.com',clientId:'test-client',clientSecret:'test-only'};
const task=(id=randomUUID()):CommandTask=>({taskId:id,source:'manual',companyId:'test',title:'Test task',status:'candidate',priority:'low',evidence:[],createdAt:new Date().toISOString()});
const note=(text:string):NewMemoryInput=>({type:'CONTEXT',statement:text,entities:[],relations:[],layer:'OPERATIONAL',sensitivity:'NORMAL',companyId:'test',source:'CONVERSATION',sourceId:'test',validFrom:'2026-09-06',confidence:'MEDIUM',createdBy:'user:test',reviewStatus:'AUTO',evidence:[]});
describe.skipIf(!adminUrl)('Real PostgreSQL cloud pilot (disposable DB only)',()=>{
  let admin:Pool,dbA:DiosDatabase,dbB:DiosDatabase,repo:PostgresCommandRepository,auth:CloudSessions;
  let runtimeA:string,runtimeB:string;
  beforeAll(async()=>{
    const url=new URL(adminUrl!);
    if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test')||process.env.NODE_ENV!=='test')throw new Error('DISPOSABLE_LOCAL_TEST_DATABASE_ONLY');
    admin=new Pool({connectionString:adminUrl});await admin.query(readFileSync('migrations/dios/001_state.sql','utf8'));
    for(const suffix of ['a','b']){
      const role=`dios_runtime_test_${suffix}`;
      await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} LOGIN PASSWORD 'ci-only-not-real' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;END IF;END $$;`);
      const grants=readFileSync('scripts/dios/runtime-grants.sql','utf8').replaceAll(':"runtime_role"',`"${role}"`).replaceAll(":'runtime_role'",`'${role}'`).replaceAll(":'tenant_id'",`'test_${suffix}'`);
      await admin.query(grants);
      await admin.query('INSERT INTO dios_members(tenant_id,email,principal) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',[`test_${suffix}`,`owner${suffix}@example.com`,JSON.stringify({role:'PRESIDENT',companyIds:['test'],label:`owner${suffix}@example.com`})]);
    }
    const a=new URL(adminUrl!);a.username='dios_runtime_test_a';a.password='ci-only-not-real';runtimeA=a.toString();
    const b=new URL(adminUrl!);b.username='dios_runtime_test_b';b.password='ci-only-not-real';runtimeB=b.toString();
    dbA=new DiosDatabase(new Pool({connectionString:runtimeA}),'test_a');dbB=new DiosDatabase(new Pool({connectionString:runtimeB}),'test_b');
    repo=new PostgresCommandRepository(dbA,new ProductionSourceRegistry());
    auth=new CloudSessions(dbA,config,{exchange:async()=>({sub:'sub-a',email:'ownera@example.com'})});
  },30000);
  afterAll(async()=>{await Promise.all([dbA?.close(),dbB?.close(),admin?.end()]);});
  async function token(service=auth){const b=await service.begin();return service.finish('fake-code',new URL(b.url).searchParams.get('state')!,b.binding);}
  it('verifies runtime role and rejects superuser even with schema present',async()=>{
    await dbA.verifyRuntimeRole();const unsafe=new DiosDatabase(new Pool({connectionString:adminUrl}),'test_a');
    try{await expect(unsafe.verifyRuntimeRole()).rejects.toThrow('UNSAFE_DATABASE_ROLE');}finally{await unsafe.close();}
    expect(()=>new PostgresCommandRepository(dbA,new DemoSourceRegistry())).toThrow();
  });
  it('RLS isolates tenants even if a query omits tenant filter or tries to change tenant setting',async()=>{
    await repo.saveTask(task('a-only'));await new PostgresCommandRepository(dbB,new ProductionSourceRegistry()).saveTask(task('b-only'));
    const a=await dbA.query<{record_id:string}>("SELECT record_id FROM dios_records WHERE bucket='tasks'");expect(a.rows.map(x=>x.record_id)).toContain('a-only');expect(a.rows.map(x=>x.record_id)).not.toContain('b-only');
    await expect(dbA.query("INSERT INTO dios_records(tenant_id,bucket,record_id,document) VALUES('test_b','tasks','spoof','{}')")).rejects.toThrow();
    await dbA.transaction(async()=>{await dbA.query("SELECT set_config('dios.tenant_id','test_b',true)");expect((await dbA.query('SELECT * FROM dios_records')).rowCount).toBe(0);});
  });
  it('runtime cannot enrol users, edit roles, or disable RLS',async()=>{
    await expect(dbA.query("UPDATE dios_members SET principal='{\"role\":\"PRESIDENT\"}'")).rejects.toThrow();
    await expect(dbA.query("INSERT INTO dios_members(tenant_id,email,principal) VALUES('test_a','evil@example.com','{}')")).rejects.toThrow();
    await expect(dbA.query('ALTER TABLE dios_records DISABLE ROW LEVEL SECURITY')).rejects.toThrow();
  });
  it('persists concurrent writes and suppresses duplicate document revisions',async()=>{
    await Promise.all(Array.from({length:16},(_,i)=>repo.saveTask(task('parallel-'+i))));
    expect((await repo.getStore()).tasks.filter(x=>x.taskId.startsWith('parallel-'))).toHaveLength(16);
    const saved=task('same-document');await repo.saveTask(saved);await repo.saveTask(saved);
    const rev=await dbA.query("SELECT version FROM dios_revisions WHERE bucket='tasks' AND record_id='same-document'");expect(rev.rowCount).toBe(1);
  });
  it('rolls back all records and history after a midway failure',async()=>{
    await expect(dbA.transaction(async()=>{await repo.saveTask(task('rollback-1'));await repo.saveTask(task('rollback-2'));throw new Error('injected');})).rejects.toThrow('injected');
    expect((await dbA.query("SELECT * FROM dios_records WHERE record_id LIKE 'rollback-%'")).rowCount).toBe(0);
    expect((await dbA.query("SELECT * FROM dios_revisions WHERE record_id LIKE 'rollback-%'")).rowCount).toBe(0);
  });
  it('preserves history and blocks deletion through runtime SQL',async()=>{
    const x=task('history');await repo.saveTask(x);await repo.saveTask({...x,status:'confirmed'});
    expect((await dbA.query("SELECT * FROM dios_revisions WHERE record_id='history'")).rowCount).toBe(2);
    await expect(dbA.query("DELETE FROM dios_records WHERE record_id='history'")).rejects.toThrow();
    await expect(dbA.query("UPDATE dios_revisions SET document='{}' WHERE record_id='history'")).rejects.toThrow();
  });
  it('preserves Memory learning safety and atomically rolls back corrections',async()=>{
    const service=new MemoryService(repo);
    await expect(service.save({...note('unverified'),type:'FACT',createdBy:'ai:curator'},new Date().toISOString())).rejects.toThrow();
    const x=await service.save(note('議事録の保管ルール'),new Date().toISOString());
    await expect(dbA.transaction(async()=>{await service.correct(x.record.memoryId,note('材料の発注方法'),new Date().toISOString(),'test','SUPERSEDED');throw new Error('rollback');})).rejects.toThrow();
    expect((await repo.getMemories()).find(m=>m.memoryId===x.record.memoryId)?.status).toBe('ACTIVE');
  });
  it('approval payload is immutable and terminal decisions cannot be replayed',async()=>{
    const a:ApprovalRequest={approvalId:'approval-1',companyId:'test',action:'SEND',target:'example',amount:100,riskLevel:4,aiReason:'test',evidence:[],status:'waiting',createdAt:new Date().toISOString()};
    await repo.saveApproval(a);await expect(repo.saveApproval({...a,amount:200})).rejects.toThrow('IMMUTABLE');
    await expect(repo.updateApproval(a.approvalId,{amount:200})).rejects.toThrow('IMMUTABLE');
    await repo.updateApproval(a.approvalId,{status:'rejected'});expect((await repo.updateApproval(a.approvalId,{status:'executed_dry_run'}))?.status).toBe('rejected');
  });
  it('stores conversation context durably across repository instances',async()=>{
    const context=emptyContext('owner-test','test');context.lastText='previous answer';await new PostgresContextStore(dbA).save(context);
    const restarted=new DiosDatabase(new Pool({connectionString:runtimeA}),'test_a');
    try{expect((await new PostgresContextStore(restarted).get('owner-test','test')).lastText).toBe('previous answer');expect((await new PostgresCommandRepository(restarted,new ProductionSourceRegistry()).getStore()).tasks.length).toBeGreaterThan(0);}finally{await restarted.close();}
  });
  it('binds OAuth state to browser, consumes once, and stores only hashed sessions',async()=>{
    const b=await auth.begin();const state=new URL(b.url).searchParams.get('state')!;
    await expect(auth.finish('fake',state,'x'.repeat(43))).rejects.toThrow();
    const t=await auth.finish('fake',state,b.binding);expect((await auth.resolve(t))?.sub).toBe('sub-a');
    await expect(auth.finish('fake',state,b.binding)).rejects.toThrow();
    expect((await dbA.query('SELECT token_hash FROM dios_sessions')).rows.every(x=>x.token_hash!==t)).toBe(true);
  });
  it('rejects uninvited account, changed subject and expired state',async()=>{
    for(const identity of [{sub:'outsider',email:'outsider@example.com'},{sub:'replacement',email:'ownera@example.com'}]){
      const other=new CloudSessions(dbA,config,{exchange:async()=>identity});await expect(token(other)).rejects.toThrow();
    }
    const b=await auth.begin();await dbA.query("UPDATE dios_oauth_states SET expires_at=now()-interval '1 second'");
    await expect(auth.finish('fake',new URL(b.url).searchParams.get('state')!,b.binding)).rejects.toThrow();
  });
  it('rechecks revocation and offboarding for every request',async()=>{
    const t=await token();await auth.revokeAll((await auth.resolve(t))!);expect(await auth.resolve(t)).toBeNull();
    const next=await token();await admin.query("UPDATE dios_members SET active=false WHERE tenant_id='test_a'");expect(await auth.resolve(next)).toBeNull();
    await admin.query("UPDATE dios_members SET active=true WHERE tenant_id='test_a'");await auth.logout(next);expect(await auth.resolve(next)).toBeNull();
  });
  it('authenticates real Hono routes, blocks CSRF and unimplemented local modules',async()=>{
    const app=createCloudApp(repo,auth);expect((await app.request('https://dios.example.com/dios')).status).toBe(302);
    expect((await app.request('https://dios.example.com/command/tasks')).status).toBe(401);
    const t=await token();const headers={cookie:`${SESSION_COOKIE}=${t}`,origin:config.origin,'content-type':'application/json'};
    expect((await app.request(config.origin+'/dios',{headers})).status).toBe(200);
    const list=await app.request(config.origin+'/command/tasks',{headers});expect(list.status).toBe(200);expect((await list.json()).tasks.length).toBeGreaterThan(0);
    expect((await app.request(config.origin+'/command/pair/start',{method:'POST',headers})).status).toBe(503);
    expect((await app.request(config.origin+'/command/chat',{method:'POST',headers:{...headers,origin:'https://evil.example.com'},body:'{}'})).status).toBe(403);
    expect((await app.request(config.origin+'/command/chat',{method:'POST',headers,body:'{"message":"hello","sessionId":"one"}'})).status).toBe(200);
    const history=await app.request(config.origin+'/command/conversation/history',{headers});expect((await history.json()).turns.some((x:{message:string})=>x.message==='hello')).toBe(true);
    expect((await app.request(config.origin+'/command/chat',{method:'POST',headers,body:'not-json'})).status).toBeGreaterThanOrEqual(400);
    expect((await app.request(config.origin+'/command/chat',{method:'POST',headers,body:'x'.repeat(40000)})).status).toBe(413);
    expect((await app.request(config.origin+'/dios/auth/logout',{method:'POST',headers})).status).toBe(200);expect(await auth.resolve(t)).toBeNull();
  });
  it('login callback sets secure cookie only after exact state validation',async()=>{
    const app=createCloudApp(repo,auth);const start=await app.request(config.origin+'/dios/auth/start');expect(start.status).toBe(302);
    const url=new URL(start.headers.get('location')!);const cookie=start.headers.get('set-cookie')!.split(';')[0];
    const cb=await app.request(config.origin+'/dios/auth/callback?code=fake&state='+url.searchParams.get('state'),{headers:{cookie}});
    expect(cb.status).toBe(303);expect(cb.headers.get('set-cookie')).toContain(SESSION_COOKIE);expect(cb.headers.get('set-cookie')).toContain('Secure');
  });
});
