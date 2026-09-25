import {InMemoryCommandRepository} from '../../../src/command/repositories/CommandRepository.js';
import {describe,it,expect} from 'vitest';
import {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK} from 'jose';
import {Pool} from 'pg';
import ExcelJS from 'exceljs';
import {DiosDatabase,databaseConfig} from '../../../src/dios/cloud/database.js';
import {GoogleCodeExchange,validateClaims,readOidcConfig,cookieValue,secureCookie,SESSION_COOKIE} from '../../../src/dios/cloud/auth.js';
import {cloudHtml} from '../../../src/dios/cloud/app.js';
import {readFileSync} from 'node:fs';
import {MemoryService,resetMemorySeq} from '../../../src/command/memory/store.js';
const config={origin:'https://dios.example.com',clientId:'test-client',clientSecret:'test-not-real'};
const claims={aud:config.clientId,iss:'https://accounts.google.com',nonce:'nonce',sub:'123',email:'Owner@Example.com',email_verified:true,exp:Math.floor(Date.now()/1000)+300};
describe('Cloud security invariants (no live identity/credentials)',()=>{
  it('accepts verified identity claims and normalizes email',()=>expect(validateClaims(claims,config.clientId,'nonce')).toEqual({sub:'123',email:'owner@example.com'}));
  it.each([{nonce:'other'},{aud:'other'},{azp:'other'},{email_verified:false},{sub:''},{exp:1},{iss:'https://attacker.example.com'},{email:'invalid'}])('rejects invalid claims %j',patch=>expect(()=>validateClaims({...claims,...patch},config.clientId,'nonce')).toThrow());
  it('verifies RS256 signature, audience and nonce rather than trusting decoded JSON',async()=>{
    const keys=await generateKeyPair('RS256');const jwk=await exportJWK(keys.publicKey);
    const token=await new SignJWT({...claims,iat:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:'1'}).sign(keys.privateKey);
    const fetcher=async()=>new Response(JSON.stringify({id_token:token}),{status:200});
    const exchange=new GoogleCodeExchange(config,fetcher as typeof fetch,createLocalJWKSet({keys:[{...jwk,kid:'1'}]}));
    expect(await exchange.exchange('code','nonce','verifier')).toEqual({sub:'123',email:'owner@example.com'});
    await expect(exchange.exchange('code','wrong','verifier')).rejects.toThrow();
    const other=await generateKeyPair('RS256');
    const bad=await new SignJWT({...claims,iat:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:'1'}).sign(other.privateKey);
    const rejected=new GoogleCodeExchange(config,(async()=>new Response(JSON.stringify({id_token:bad}))) as typeof fetch,createLocalJWKSet({keys:[{...jwk,kid:'1'}]}));
    await expect(rejected.exchange('code','nonce','verifier')).rejects.toThrow();
  });
  it('requires exact HTTPS origin; no path or embedded username',()=>{
    expect(()=>readOidcConfig({...process.env,DIOS_PUBLIC_ORIGIN:'http://localhost',DIOS_GOOGLE_CLIENT_ID:'x',DIOS_GOOGLE_CLIENT_SECRET:'x'})).toThrow();
    expect(readOidcConfig({DIOS_PUBLIC_ORIGIN:config.origin,DIOS_GOOGLE_CLIENT_ID:'x',DIOS_GOOGLE_CLIENT_SECRET:'x'}).origin).toBe(config.origin);
  });
  it('never allows duplicate or malformed cookies',()=>{
    const token='a'.repeat(43);expect(cookieValue(`${SESSION_COOKIE}=${token}`,SESSION_COOKIE)).toBe(token);
    expect(cookieValue(`${SESSION_COOKIE}=${token};${SESSION_COOKIE}=${token}`,SESSION_COOKIE)).toBeUndefined();
    expect(secureCookie(SESSION_COOKIE,token,60)).toContain('HttpOnly; Secure; SameSite=Lax; Path=/');
  });
  it('uses TLS validation, rejects URL TLS overrides, and never loses Cloud SQL socket to connectionString',()=>{
    const base={DIOS_DATABASE_URL:'postgresql://u:p@localhost/dios_test'};
    expect(databaseConfig(base).ssl).toEqual({rejectUnauthorized:true});
    expect(()=>databaseConfig({...base,DIOS_DATABASE_URL:base.DIOS_DATABASE_URL+'?sslmode=disable'})).toThrow();
    expect(()=>databaseConfig({...base,DIOS_DATABASE_TRANSPORT:'local-test',NODE_ENV:'production'})).toThrow();
    const socket=databaseConfig({...base,DIOS_DATABASE_TRANSPORT:'cloudsql-socket',DIOS_CLOUDSQL_SOCKET:'/cloudsql/example-project:asia-northeast1:dios-db'});
    const pool=new Pool(socket);expect(pool.options.host).toBe('/cloudsql/example-project:asia-northeast1:dios-db');expect(socket.connectionString).toBeUndefined();void pool.end();
  });
  it('rejects untrusted tenant identifiers before connecting',()=>expect(()=>new DiosDatabase(new Pool(),"x';select" )).toThrow());
  it('cloud UI keeps Google cookie login, loads durable history, and cannot accept URL bearer tokens',()=>{
    const html=cloudHtml(readFileSync('docs/lcc-command-vui.html','utf8'));
    expect(html).toContain("apiToken: ''");expect(html).not.toContain("apiToken: (() => {");
    expect(html).toContain('/command/conversation/history');expect(html).toContain('owner-conversation');
    expect(html).toContain('/dios/auth/logout');expect(html).toContain('Googleで再ログイン');
  });
  it('IDs do not collide when process counters reset',async()=>{
    const now='2026-09-06T00:00:00.000Z';
    const create=()=>new MemoryService(new InMemoryCommandRepository()).save({type:'CONTEXT',statement:'test note',entities:[],relations:[],layer:'OPERATIONAL',sensitivity:'NORMAL',companyId:'test',source:'CONVERSATION',sourceId:'test',validFrom:now,confidence:'MEDIUM',createdBy:'user:test',reviewStatus:'AUTO',evidence:[]},now);
    const first=await create();resetMemorySeq();expect((await create()).record.memoryId).not.toBe(first.record.memoryId);
  });
  it('patched uuid remains compatible with ExcelJS extension generation',async()=>{
    const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Test');ws.getCell('A1').value=10;
    ws.addConditionalFormatting({ref:'A1',rules:[{type:'dataBar',cfvo:[{type:'min'},{type:'max'}],gradient:true,color:{argb:'FF0000FF'},priority:1}]});
    const buffer=await wb.xlsx.writeBuffer();expect(buffer.byteLength).toBeGreaterThan(1000);
    const read=new ExcelJS.Workbook();await read.xlsx.load(buffer);expect(read.getWorksheet('Test')?.getCell('A1').value).toBe(10);
  });
});
