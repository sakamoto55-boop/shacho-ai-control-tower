import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Principal } from '../../command/domain/types.js';
import { createCommandApp } from '../../command/server/routes.js';
import { PostgresCommandRepository } from './repository.js';
import { PostgresAuditLog, PostgresContextStore } from './state.js';
import { CloudSessions, SESSION_COOKIE, STATE_COOKIE, cookieValue, secureCookie, type Session } from './auth.js';
import { brandDiosHtml, mountDiosShell } from '../runtime.js';
import { containsSensitiveContent } from '../../command/memory/store.js';
import { ObservabilityLog } from '../../command/observability/observability.js';

export function cloudHtml(original:string):string {
  const tokenStart=original.indexOf('apiToken: (() => {');
  const tokenEnd=original.indexOf('      demoRequested:',tokenStart);
  if (tokenStart<0 || tokenEnd<0) throw new Error('DIOS_UI_AUTH_PATCH_MISMATCH');
  let html=original.slice(0,tokenStart)+"apiToken: '',\n"+original.slice(tokenEnd);
  html=html.replace("apiBase: new URLSearchParams(location.search).get('api') || '',","apiBase: '',")
    .replace("demoRequested: new URLSearchParams(location.search).get('demo') === '1',","demoRequested: false,")
    .replace('if (res.status === 401) {', "if (res.status === 401) { location.assign('/dios/login'); return;")
    .replace('markAuth(status){',"markAuth(status){ if(status===401){ location.assign('/dios/login'); return true; }")
    .replaceAll('/command/pair/logout','/dios/auth/logout')
    .replace('async startPairing(){', "async startPairing(){ this.pairCodeNote='別の端末も同じURLからGoogleでログインしてください'; return;")
    .replace('async logoutDevice(){', "async logoutDevice(){ const logout=await fetch('/dios/auth/logout',{method:'POST'}); if(logout.ok){location.assign('/dios/login');}else{this.pairAdminNote='ログアウトできませんでした。再試行してください';} return;")
    .replaceAll('/command/pair/revoke-all','/dios/auth/revoke-all')
    .replace("sessionId: 'vui-' + Math.random().toString(36).slice(2, 10),","sessionId: 'owner-conversation',");
  html=html.replace('    await this.loadKpi();', `    try { localStorage.removeItem('lcc_command_token'); } catch {}
    try {
      const r = await fetch('/command/conversation/history', {credentials:'same-origin'});
      if(r.ok) {
        const h = await r.json();
        this.messages = (h.turns || []).slice().reverse().flatMap(t => [
          {role:'user',text:t.message}, {role:'ai',text:t.answer,done:true,evidence:t.evidence||[],confidence:'UNKNOWN'}
        ]);
      } else if(r.status===401) {location.assign('/dios/login');return;}
    } catch { this.connectionError=true; }
    await this.loadKpi();`);
  html=html.replaceAll('PCに表示した6桁コードで接続してください。','Googleで再ログインしてください。');
  html=brandDiosHtml(html,'local');
  return html.replace('実装検証版：本番未検収。接続状態は「データ接続」で確認してください。','クラウド試験運用：社長専用。外部送信・銀行振込は無効です。');
}
const allowedGet=new Set(['/health','/kpi','/brief','/cash/forecast','/alerts','/approvals','/decisions','/tasks','/research','/data-quality','/projects/summary','/personnel/summary','/memory','/experiments','/data-gaps','/capabilities','/providers','/targets','/constitution','/future','/ai-capabilities','/stewardship','/search','/sources','/events','/core-state','/artifacts']);
const allowedPost=[/^\/chat$/,/^\/cash\/scenario$/,/^\/decisions$/,/^\/approvals\/[^/]+\/(approve|reject)$/,/^\/memory\/[^/]+\/(confirm|archive)$/,/^\/memory\/conflicts\/resolve$/,/^\/feedback$/];
class RollbackResponse extends Error { constructor(readonly response:Response) { super('DIOS_HTTP_ROLLBACK'); } }
const page=(message:string)=>`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DIOS</title><body style="background:#07111f;color:#edf5fb;font:16px system-ui;padding:32px;max-width:640px;margin:auto"><h1>DIOS</h1><p>${message}</p><a href="/dios/auth/start" style="color:#a6cbff;display:block;padding:18px;border:1px solid #456;border-radius:12px">Googleでログイン</a><p>接続済みの会社アカウントだけ利用できます。</p></body></html>`;
const redact=(s:string)=>containsSensitiveContent(s)||/(password|api.?key|secret|token|パスワード|暗証番号)\s*[:=：]/i.test(s)?'[機密情報のため本文を履歴へ複製していません]':s;

/** Owner pilot only. Reuses COMMAND services, but never imports the legacy file-backed server. */
export function createCloudApp(repo:PostgresCommandRepository,auth:CloudSessions) {
  const app=new Hono<{Variables:{diosSession:Session}}>();
  const db=repo.db;
  app.use('*',async(c,next)=>{
    c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');
    c.header('X-Content-Type-Options','nosniff');c.header('X-Frame-Options','DENY');
    c.header('Strict-Transport-Security','max-age=31536000');
    c.header('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    await next();
  });
  app.use('*',bodyLimit({maxSize:32768,onError:c=>c.json({error:'REQUEST_TOO_LARGE'},413)}));
  app.onError((_e,c)=>c.json({error:'DIOS_REQUEST_FAILED',message:'処理を完了できませんでした。保存済みとは表示しません。'},503));
  app.get('/health',c=>c.json({ok:true,service:'DIOS',mode:'cloud-pilot',productionReady:false}));
  app.get('/ready',async c=>{await db.verifyRuntimeRole();return c.json({ok:true,storage:'postgres',liveConnectionsVerified:false});});
  app.get('/dios/login',c=>c.html(page('保存先はクラウドです。PCとiPhoneで同じ記憶を利用します。')));
  app.get('/dios/auth/start',async c=>{
    if(!await auth.allowRate('login',30))return c.json({error:'RATE_LIMITED'},429);
    const result=await auth.begin();c.header('Set-Cookie',secureCookie(STATE_COOKIE,result.binding,600));return c.redirect(result.url,302);
  });
  app.get('/dios/auth/callback',async c=>{
    const binding=cookieValue(c.req.header('cookie'),STATE_COOKIE)??'';
    c.header('Set-Cookie',secureCookie(STATE_COOKIE,'',0));
    try{
      const token=await auth.finish(c.req.query('code')??'',c.req.query('state')??'',binding);
      c.header('Set-Cookie',secureCookie(SESSION_COOKIE,token,43200),{append:true});return c.redirect('/dios',303);
    }catch{return c.html(page('認証できませんでした。招待されたアカウントでログインをやり直してください。'),401);}
  });
  const session = async(c:Context)=>auth.resolve(cookieValue(c.req.header('cookie'),SESSION_COOKIE));
  app.use('/dios/auth/*',async(c,next)=>{
    if(c.req.method!=='POST')return c.notFound();
    if(c.req.header('origin')!==auth.config.origin)return c.json({error:'ORIGIN_REJECTED'},403);
    const s=await session(c);if(!s)return c.json({error:'UNAUTHORIZED'},401);c.set('diosSession',s);await next();
  });
  app.post('/dios/auth/logout',async c=>{await auth.logout(cookieValue(c.req.header('cookie'),SESSION_COOKIE));c.header('Set-Cookie',secureCookie(SESSION_COOKIE,'',0));return c.json({ok:true});});
  app.post('/dios/auth/revoke-all',async c=>{await auth.revokeAll(c.get('diosSession'));c.header('Set-Cookie',secureCookie(SESSION_COOKIE,'',0));return c.json({ok:true,revoked:'all'});});
  app.get('/dios',async c=>{
    if(!await session(c))return c.redirect('/dios/login',302);
    if(c.req.query('token')||c.req.query('api')||c.req.query('demo'))return c.redirect('/dios',302);
    return c.html(cloudHtml(await readFile(new URL('../../../docs/lcc-command-vui.html',import.meta.url),'utf8')));
  });
  app.get('/vendor/:file',async c=>{
    const types:Record<string,string>={'vue.global.prod.js':'text/javascript','tw.css':'text/css'};
    const f=c.req.param('file');if(!Object.hasOwn(types,f))return c.notFound();c.header('Content-Type',types[f]);
    return c.body(await readFile(new URL(`../../../docs/vendor/${f}`,import.meta.url)));
  });
  app.use('/command/*',async(c,next)=>{
    const s=await session(c);if(!s)return c.json({error:'UNAUTHORIZED'},401);
    if(c.req.method==='POST' && (c.req.header('origin')!==auth.config.origin || !(c.req.header('content-type')??'').startsWith('application/json')))return c.json({error:'CSRF_REJECTED'},403);
    if(!await auth.allowRate('member:'+s.sub))return c.json({error:'RATE_LIMITED'},429);
    c.set('diosSession',s);
    const path=new URL(c.req.url).pathname.slice('/command'.length);
    const custom=['/today/decisions','/health/connections','/conversation/history'];
    if(!(c.req.method==='GET'&&(allowedGet.has(path)||custom.includes(path))) && !(c.req.method==='POST'&&allowedPost.some(r=>r.test(path))))return c.json({error:'CLOUD_MODULE_PENDING',message:'この機能はクラウド移行の検証待ちです。'},503);
    const requestText=path==='/chat'?await c.req.raw.clone().text():null;
    try{
      await db.transaction(async()=>{
        await next();
        if(c.res.status>=400)throw new RollbackResponse(c.res);
        if(requestText){
          const input=JSON.parse(requestText) as {message?:string;sessionId?:string};
          const result=await c.res.clone().json() as {text?:string;evidence?:unknown[]};
          await db.query("INSERT INTO dios_records(tenant_id,bucket,record_id,document) VALUES($1,'conversationTurns',$2,$3::jsonb)",
            [db.tenantId,randomUUID(),JSON.stringify({actor:s.sub,sessionId:input.sessionId??'owner-conversation',message:redact(input.message??''),answer:redact(result.text??''),evidence:result.evidence??[],createdAt:new Date().toISOString()})]);
        }
      },true);
    }catch(e){if(e instanceof RollbackResponse){c.res=e.response;return;}throw e;}
  });
  app.get('/command/conversation/history',async c=>{
    const rows=await db.query<{document:unknown}>("SELECT document FROM dios_records WHERE tenant_id=$1 AND bucket='conversationTurns' AND document->>'actor'=$2 ORDER BY updated_at DESC LIMIT 50",[db.tenantId,c.get('diosSession').sub]);return c.json({turns:rows.rows.map(r=>r.document)});
  });
  app.get('/command/today/decisions',async c=>{
    const store=await repo.getStore();
    return c.json({items:store.approvals.filter(a=>a.status==='waiting').map(a=>({id:a.approvalId,title:a.action,reason:a.aiReason,detail:a.aiReason,source:'DIOS承認台帳',trustLabel:'社内承認待ち（実行は無効）',recommendation:'内容を確認',nextAction:'AIに承認内容を確認',priority:2,approval:a})),decisions:[],tracking:{trackingCount:store.tasks.filter(t=>t.status!=='done').length,completedTodayCount:null},limitations:['外部タスクの追跡は未接続です']});
  });
  app.get('/command/health/connections',async c=>{
    const data=await repo.getDataset(new Date().toISOString());
    return c.json({connections:data.meta.sources.map(s=>({system:s.sourceName,classification:s.errorState?'NOT_CONNECTED':'SHEET_INGESTED',status:s.errorState?'UNAVAILABLE':'READ_ONLY',lastSyncedAt:s.lastSuccessfulSync,reason:s.errorState,readOnly:true})),externalWritesEnabled:false});
  });
  app.post('/command/feedback',async c=>{
    const b=await c.req.json() as Record<string,unknown>;
    if(b.rating!=='good'&&b.rating!=='bad')return c.json({error:'INVALID_RATING'},400);
    await db.query("INSERT INTO dios_records(tenant_id,bucket,record_id,document) VALUES($1,'feedback',$2,$3::jsonb)",
      [db.tenantId,randomUUID(),JSON.stringify({actor:c.get('diosSession').sub,rating:b.rating,
        comment:typeof b.comment==='string'?redact(b.comment.slice(0,300)):undefined,createdAt:new Date().toISOString()})]);
    return c.json({ok:true,note:'評価をクラウドに保存しました。モデルの自動学習には使用しません。'});
  });
  const command=createCommandApp({repository:repo,auditLog:new PostgresAuditLog(db),contextStore:new PostgresContextStore(db),disableLocalArtifacts:true,observabilityLog:new ObservabilityLog(''),
    authenticateRequest:async c=>(c.get('diosSession') as Session|undefined)?.principal as Principal??null});
  app.route('/command',command);
  app.get('/dios/runtime.json',c=>c.json({product:'DIOS',mode:'cloud-pilot',storage:'postgres',productionReady:false,releaseGate:'LIVE_ACCEPTANCE_REQUIRED'}));
  mountDiosShell(app,'local');
  return app;
}
