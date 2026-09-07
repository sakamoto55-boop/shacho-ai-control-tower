import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Pool } from 'pg';
import { DiosDatabase, databaseConfig } from './dios/cloud/database.js';
import { readOidcConfig, GoogleCodeExchange, CloudSessions } from './dios/cloud/auth.js';
import { PostgresCommandRepository } from './dios/cloud/repository.js';
import { createCloudApp } from './dios/cloud/app.js';
import { createSheetsRegistryFromEnv } from './command/sources/googleSheets.js';
import { ProductionSourceRegistry } from './command/sources/SourceAdapter.js';
import { isMainModule } from './utils/mainModule.js';

export async function createCloudRuntime(env:NodeJS.ProcessEnv=process.env) {
  if(env.DIOS_RUNTIME_MODE!=='cloud-pilot')throw new Error('DIOS_EXPLICIT_CLOUD_PILOT_REQUIRED');
  if(env.LCC_COMMAND_MODE==='demo'||env.LCC_SHEETS_SNAPSHOT_DIR||env.GOOGLE_SHEETS_API_KEY)throw new Error('DIOS_CLOUD_TEST_SOURCE_REJECTED');
  const config=readOidcConfig(env);
  const db=new DiosDatabase(new Pool(databaseConfig(env)),env.DIOS_TENANT_ID??'');
  try {
    await db.verifyRuntimeRole();
    const sources=createSheetsRegistryFromEnv(env)??new ProductionSourceRegistry();
    const repo=new PostgresCommandRepository(db,sources);
    const auth=new CloudSessions(db,config,new GoogleCodeExchange(config));
    return {app:createCloudApp(repo,auth),db};
  }catch(e){await db.close();throw e;}
}
if(isMainModule(import.meta.url)){
  try{
    const {app,db}=await createCloudRuntime();
    const server=serve({fetch:app.fetch,port:Number(process.env.PORT??8080),hostname:'0.0.0.0'});
    console.log('DIOS cloud-pilot listening; external writes disabled; live acceptance pending');
    const shutdown=()=>{
      server.close(()=>{void db.close().finally(()=>process.exit(0));});
      setTimeout(()=>process.exit(1),9000).unref();
    };
    process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  }catch{console.error('DIOS_CLOUD_STARTUP_REJECTED: verify configuration, database role, schema and identity setup');process.exitCode=1;}
}
