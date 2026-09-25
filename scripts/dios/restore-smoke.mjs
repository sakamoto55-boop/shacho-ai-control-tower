import process from 'node:process';
import console from 'node:console';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {URL} from 'node:url';
const container=process.env.DIOS_TEST_PG_CONTAINER;
const url=new URL(process.env.DIOS_TEST_DATABASE_URL??'');
if(process.env.CI!=='true'||!/^[a-f0-9]{12,64}$/.test(container??'')||!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/dios_test')throw new Error('CI_DISPOSABLE_RESTORE_ONLY');
function run(args,input){const r=spawnSync('docker',['exec',...(input?['-i']:[]),container,...args],{input,timeout:60000,maxBuffer:20*1024*1024});if(r.status!==0)throw new Error('POSTGRES_RESTORE_COMMAND_FAILED');return r.stdout;}
const archive=run(['pg_dump','-U','postgres','-d','dios_test','-Fc','--no-owner','--no-acl','--exclude-table-data=dios_sessions','--exclude-table-data=dios_oauth_states','--exclude-table-data=dios_rate_limits']);
run(['createdb','-U','postgres','dios_restore_test']);
run(['pg_restore','-U','postgres','-d','dios_restore_test','--no-owner','--no-acl','--exit-on-error'],archive);
const restored=new URL(url);restored.pathname='/dios_restore_test';
const source=new Pool({connectionString:url.toString()}),target=new Pool({connectionString:restored.toString()});
try{
  for(const table of ['dios_records','dios_revisions','dios_audit','dios_members','dios_tenant_roles']){
    const query=`SELECT row_to_json(t) AS row FROM (SELECT * FROM ${table}) t ORDER BY row_to_json(t)::text`;
    if(JSON.stringify((await source.query(query)).rows)!==JSON.stringify((await target.query(query)).rows))throw new Error('RESTORE_DATA_MISMATCH:'+table);
  }
  for(const table of ['dios_sessions','dios_oauth_states','dios_rate_limits'])if((await target.query(`SELECT * FROM ${table}`)).rowCount!==0)throw new Error('AUTH_STATE_SHOULD_NOT_RESTORE');
  console.log(JSON.stringify({status:'PASS',scope:'disposable Postgres dump/restore, not production backup',sha256:createHash('sha256').update(archive).digest('hex'),authStateRestored:false}));
}finally{await source.end();await target.end();}
