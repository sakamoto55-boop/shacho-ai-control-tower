import process from 'node:process';
import console from 'node:console';
import {URL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {databaseConfig} from '../../dist/dios/cloud/database.js';
if(process.env.DIOS_MIGRATION_APPROVED!=='yes')throw new Error('DIOS_MIGRATION_APPROVAL_REQUIRED');
const pool=new Pool(databaseConfig(process.env));
try{await pool.query(await readFile(new URL('../../migrations/dios/001_state.sql',import.meta.url),'utf8'));console.log('DIOS schema version 1 applied');}
finally{await pool.end();}
