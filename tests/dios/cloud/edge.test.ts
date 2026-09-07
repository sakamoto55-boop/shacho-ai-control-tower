import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import {DiosDatabase} from '../../../src/dios/cloud/database.js';
import {PostgresCommandRepository} from '../../../src/dios/cloud/repository.js';
import {ProductionSourceRegistry} from '../../../src/command/sources/SourceAdapter.js';
import {CloudSessions,SESSION_COOKIE} from '../../../src/dios/cloud/auth.js';
import {createCloudApp} from '../../../src/dios/cloud/app.js';
const supplied=process.env.DIOS_TEST_DATABASE_URL;
if(process.env.DIOS_CLOUD_TEST_REQUIRED==='true'&&!supplied)throw new Error('REAL_POSTGRES_REQUIRED');
describe.skipIf(!supplied)('PostgreSQL edge cases (isolated disposable database)',()=>{
  let admin:Pool,db:DiosDatabase,auth:CloudSessions,url:string,operatorUrl:string;
  const cfg={origin:'https://dios.example.com',clientId:'fake-client',clientSecret:'fake-only'};
  beforeAll(async()=>{
    const u=new URL(supplied!);
    if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/dios_test'||process.env.NODE_ENV!=='test')throw new Error('CI_DATABASE_ONLY');
    const root=new Pool({connectionString:u.toString()});
    try{await root.query('CREATE DATABASE dios_edge_test');}finally{await root.end();}
    u.pathname='/dios_edge_test';admin=new Pool({connectionString:u.toString()});
    await admin.query(readFileSync('migrations/dios/001_state.sql','utf8'));
    await admin.query("CREATE ROLE dios_edge_runtime LOGIN PASSWORD 'edge-test-only' NOSUPERUSER NOBYPASSRLS NOCREATEROLE");
    await admin.query(readFileSync('scripts/dios/runtime-grants.sql','utf8').replaceAll(':"runtime_role"','"dios_edge_runtime"').replaceAll(":'runtime_role'","'dios_edge_runtime'").replaceAll(":'tenant_id'","'edge'"));
    await admin.query("CREATE ROLE dios_edge_operator LOGIN PASSWORD 'edge-test-only' NOSUPERUSER NOBYPASSRLS NOCREATEROLE");
    await admin.query('GRANT USAGE ON SCHEMA public TO dios_edge_operator; GRANT SELECT,INSERT ON dios_tenant_roles,dios_members TO dios_edge_operator');
    u.username='dios_edge_operator';u.password='edge-test-only';operatorUrl=u.toString();
    u.username='dios_edge_runtime';url=u.toString();db=new DiosDatabase(new Pool({connectionString:url}),'edge');
    auth=new CloudSessions(db,cfg,{exchange:async()=>({sub:'edge-sub',email:'edge-owner@example.com'})});
  },30000);
  afterAll(async()=>{await Promise.all([admin?.end(),db?.close()]);});
  function enrol(connection:string){return spawnSync(process.execPath,['scripts/dios/enroll-owner.mjs'],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_ENV:'test',DIOS_DATABASE_URL:connection,DIOS_DATABASE_TRANSPORT:'local-test',DIOS_TENANT_ID:'edge',DIOS_OWNER_ENROLL_APPROVED:'yes',DIOS_OWNER_EMAIL:'edge-owner@example.com',DIOS_OWNER_COMPANIES:'["test"]'}});}
  async function login(){const b=await auth.begin();return auth.finish('fake',new URL(b.url).searchParams.get('state')!,b.binding);}
  it('enrols through non-superuser migration operator without granting runtime self-enrolment',async()=>{
    expect(enrol(operatorUrl).status).toBe(0);
    expect((await admin.query("SELECT * FROM dios_members WHERE tenant_id='edge'")).rowCount).toBe(1);
    expect(enrol(url).status).not.toBe(0);
  });
  it('persists valid feedback and never copies secret-bearing comments',async()=>{
    const app=createCloudApp(new PostgresCommandRepository(db,new ProductionSourceRegistry()),auth);
    const t=await login();const headers={cookie:`${SESSION_COOKIE}=${t}`,origin:cfg.origin,'content-type':'application/json'};
    const r=await app.request(cfg.origin+'/command/feedback',{method:'POST',headers,body:JSON.stringify({rating:'good',comment:'password: do-not-copy'})});
    expect(r.status).toBe(200);
    const fresh=new DiosDatabase(new Pool({connectionString:url}),'edge');
    try{const rows=await fresh.query("SELECT document FROM dios_records WHERE bucket='feedback'");expect(rows.rowCount).toBe(1);expect(rows.rows[0].document.rating).toBe('good');expect(JSON.stringify(rows.rows)).not.toContain('do-not-copy');}finally{await fresh.close();}
    expect((await app.request(cfg.origin+'/command/feedback',{method:'POST',headers,body:'{"rating":"unknown"}'})).status).toBe(400);
    expect((await db.query("SELECT * FROM dios_records WHERE bucket='feedback'")).rowCount).toBe(1);
  });
  it('expires sessions and enforces shared database-backed rate limiting',async()=>{
    const t=await login();expect(await auth.resolve(t)).not.toBeNull();
    await admin.query("UPDATE dios_sessions SET expires_at=now()-interval '1 second'");expect(await auth.resolve(t)).toBeNull();
    expect(await auth.allowRate('edge-limit',2)).toBe(true);expect(await auth.allowRate('edge-limit',2)).toBe(true);expect(await auth.allowRate('edge-limit',2)).toBe(false);
  });
});
