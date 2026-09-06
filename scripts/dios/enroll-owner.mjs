import process from 'node:process';
import console from 'node:console';
import {Pool} from 'pg';
import {DiosDatabase,databaseConfig} from '../../dist/dios/cloud/database.js';
if(process.env.DIOS_OWNER_ENROLL_APPROVED!=='yes')throw new Error('DIOS_OWNER_ENROLL_APPROVAL_REQUIRED');
const email=(process.env.DIOS_OWNER_EMAIL??'').trim().toLowerCase();
if(!/^[^\s@]+@[^\s@]+$/.test(email))throw new Error('DIOS_OWNER_EMAIL_REQUIRED');
const companies=JSON.parse(process.env.DIOS_OWNER_COMPANIES??'[]');
if(!Array.isArray(companies)||!companies.length||companies.some(x=>typeof x!=='string'||!/^[a-z0-9_-]+$/.test(x)))throw new Error('DIOS_OWNER_COMPANIES_REQUIRED');
const db=new DiosDatabase(new Pool(databaseConfig(process.env)),process.env.DIOS_TENANT_ID??'');
try{
  await db.transaction(async()=>{
    // Explicit migration operator only. The runtime role cannot insert tenant bindings.
    await db.query('INSERT INTO dios_tenant_roles(tenant_id,role_name) VALUES($1,current_user) ON CONFLICT DO NOTHING',[db.tenantId]);
    await db.query('INSERT INTO dios_members(tenant_id,email,principal) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',
      [db.tenantId,email,JSON.stringify({role:'PRESIDENT',companyIds:companies,label:email})]);
  });
  console.log('Owner enrolment completed; existing accounts were not altered');
}finally{await db.close();}
