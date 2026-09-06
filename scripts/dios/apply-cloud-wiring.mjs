// One-time, hash-bound source migration; all files are verified before any writes.
// Already-applied files are left untouched. Any divergent source stops without changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
const specs = [
['src/command/artifacts/artifactRegistry.ts','77e020b9ff44599e8bd0362e0d9fc1e81cfb54a019a1fb8fb6b2260f2f85f249','e15359b0a3aecb7e3ccd2ab72f11a5cb41b10286bf1fb33d47c289470f99b443'],
['src/command/constitution/constitutionRegistry.ts','c3331e4d42753bda9ed59a6c7e9b1267b9b14a86427605597423d03cd44e75b9','a0dd222c50c98ebe1a53d5475edac9408b5e2d637ce201a941b2afeb23c2caf9'],
['src/command/growth/growthBacklog.ts','20df36951a28d527a1c4882f80a164f2b9f5ef737785c2caa2b2e743ba5b55e5','10ac2a3ee5a4534263d02eabca9178da1aeac137649169b14a96d9977aa4fe86'],
['src/command/growth/promotionPipeline.ts','174f0a599f66a7b5d7de14ef3f8d048d4de970f0d1f8181cac61fa9f32e7739f','40c21e409701332d157eb9da1cb0f8f32d8f5f4a9ed1aae6257c3be3e3d10f28'],
['src/command/livebeta/incidentLog.ts','8570e6e81f3099a3ecff51655323f1aa7129527211e1d4396474cfb0996a799b','3687c114348cf93c855d7f15ab3cb21798388bcd604eef7d93b3e3e919dcf084'],
['src/command/memory/maintenance.ts','8e11bd68c0fc6a684c49d36f571a8277b7dd2b95162699c2a10e9581fb3f1907','b6b59ebb18346fe6cf9bbbbe98a79f0690fc295efbeb6106ec1d7a34270a928b'],
['src/command/memory/store.ts','40436af908710da619e42217d29b8552288cb4f6994f80b0fa0de1a8913e6abc','fc2789868425ec021963ab89a1dbdae6dd80b8054dddf38bb4ffb1b5c2007e01'],
['src/command/orchestrator/context.ts','d2858e07e9d584d577310bc5664fc8558865da7ad2a492e11a2ff5fbfdaf4723','e5c262ab33e637664d82ed9811dc10968747a5b3088df481d36944a72835eeb0'],
['src/command/orchestrator/orchestrator.ts','5a4a7578a5a502b3e971ad10f0f2b6cab9d60e4928e5972e17f153e7677d5113','221f0c2043730e0adacf708b5b6ebfb703af67f1090eddc58404cb0ff45137ef'],
['src/command/server/routes.ts','61b84e8d8f6969587455d48132263b394f41e5bc07adcfa21a3eaef688545ae0','8d1dc429aa45a4a46b62f0b6e94f2574110b52779e025c47dd69fc3a2ee99f44'],
['src/command/targets/targetRegistry.ts','c7b27b343169d22a02ef2eb804caf8e183410d829c6313bd89486e65ecfd4a84','71fe374453004a32eb06671a795a4bf8274c79c12c331fd3098cf58f24a78b8e'],
['src/command/tools/registry.ts','dac55e27e356d7f17645a0c43f7aea3b092f441156a3939875cc00450c17340f','3e93dd90821e994cfce1c89fe1f6527834f3eb7d951f9ca6e77d8ffb452dec34'],
['src/dios/runtime.ts','123d57f693ac15a1bb05625e44b0996b2daff0cac4b7314d7a691cab8b5beba0','d859e5f9b3cef89f0982d51e5d11d9916f7aa452842278ffbbe4e9908805d96d']
];
const idExpressions = {
 'src/command/artifacts/artifactRegistry.ts': "`art-${now.slice(0, 10)}-${String(artifactSeq).padStart(3, '0')}`",
 'src/command/constitution/constitutionRegistry.ts': '`const-${principleSeq}`',
 'src/command/growth/growthBacklog.ts': "`${prefix}-${String(growthSeq).padStart(3, '0')}`",
 'src/command/growth/promotionPipeline.ts': "`imp-${String(improvementSeq).padStart(3, '0')}`",
 'src/command/livebeta/incidentLog.ts': "`inc-${String(incidentSeq).padStart(3, '0')}`",
 'src/command/memory/maintenance.ts': '`exp-${now.slice(0, 10)}-${expSeq++}`',
 'src/command/memory/store.ts': '`mem-${now.slice(0, 10)}-${memorySeq++}`',
 'src/command/targets/targetRegistry.ts': "`tgt-${now.slice(0, 10)}-${String(targetSeq).padStart(3, '0')}`",
 'src/command/tools/registry.ts': '`${prefix}-${asOf.slice(0, 10)}-${idSeq++}`'
};
const hash=s=>createHash('sha256').update(s).digest('hex');
const patches=[];
for(const [path,before,after] of specs){
 let s=readFileSync(path,'utf8');
 if(hash(s)===after)continue;
 if(hash(s)!==before)throw new Error('DIVERGED_SOURCE:'+path);
 const replace=(old,next,count=1)=>{
   if(s.split(old).length-1!==count)throw new Error('ANCHOR_MISMATCH:'+path);
   s=s.split(old).join(next);
 };
 if(Object.hasOwn(idExpressions,path)){
   const old=idExpressions[path];replace(old,old.slice(0,-1)+'-${persistentUuid()}`');
   s="import { randomUUID as persistentUuid } from 'node:crypto';\n"+s;
 }else if(path.endsWith('/context.ts')){
   replace('export class ContextStore {',`export interface ConversationContextStore {
  get(sessionId: string, defaultScope: CompanyScope): ConversationContext | Promise<ConversationContext>;
  save(context: ConversationContext): void | Promise<void>;
}

export class ContextStore implements ConversationContextStore {`);
 }else if(path.endsWith('/orchestrator.ts')){
   replace("import { ContextStore, type ConversationContext, type IntentKey } from './context.js';","import { ContextStore, type ConversationContext, type ConversationContextStore, type IntentKey } from './context.js';");
   replace('export interface OrchestratorOptions {',`export interface OrchestratorOptions {
  contextStore?: ConversationContextStore;
  /** Cloud pilot: artifact planning is supported, local file rendering is not. */
  disableLocalArtifacts?: boolean;`);
   replace('private readonly contexts = new ContextStore();','private readonly contexts: ConversationContextStore;');
   replace('    this.memoryService = new MemoryService(repository);','    this.contexts = options.contextStore ?? new ContextStore();\n    this.memoryService = new MemoryService(repository);');
   replace("    const context = this.contexts.get(sessionId, request.scope ?? 'group');","    const contextKey = `${principal.role}:${principal.label}:${sessionId}`;\n    const context = await this.contexts.get(contextKey, request.scope ?? 'group');");
   replace('this.remember(context,','await this.remember(context,',3);
   replace("if (rendererReady && artifactType !== 'IMAGE'","if (!this.options.disableLocalArtifacts && rendererReady && artifactType !== 'IMAGE'");
   replace('private remember(context: ConversationContext, scope: CompanyScope, result: HandlerResult): void {','private async remember(context: ConversationContext, scope: CompanyScope, result: HandlerResult): Promise<void> {');
   replace('    this.contexts.save(context);','    await this.contexts.save(context);');
 }else if(path.endsWith('/routes.ts')){
   replace('export interface CommandAppOptions {',`export interface CommandAppOptions {
  /** Trusted server-side session resolver. Never accept a user-supplied Principal header. */
  authenticateRequest?: (context: Context) => Promise<Principal | null>;
  contextStore?: import('../orchestrator/context.js').ConversationContextStore;
  disableLocalArtifacts?: boolean;
`);
   replace('    observability,\n    eventBus\n','    observability,\n    eventBus,\n    contextStore: options.contextStore,\n    disableLocalArtifacts: options.disableLocalArtifacts\n');
   replace('    const principal = sessionPrincipal','    const principal = options.authenticateRequest\n      ? await options.authenticateRequest(c)\n      : sessionPrincipal');
 }else if(path==='src/dios/runtime.ts'){
   replace("import type { Hono } from 'hono';","import type { Hono, Env } from 'hono';");
   replace('export function mountDiosShell(app: Hono, mode: DiosRuntimeMode): void {','export function mountDiosShell<E extends Env>(app: Hono<E>, mode: DiosRuntimeMode): void {');
 }else throw new Error('UNEXPECTED_PATH');
 if(hash(s)!==after)throw new Error('EXPECTED_OUTPUT_MISMATCH:'+path);
 patches.push([path,s]);
}
if(process.argv.includes('--list'))console.log(specs.map(s=>s[0]).join('\n'));
else{
 for(const [path,content] of patches)writeFileSync(path,content);
 console.log(JSON.stringify({changed:patches.map(p=>p[0]),alreadyApplied:specs.length-patches.length}));
}
