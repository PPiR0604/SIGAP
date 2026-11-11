// Synthetic review-only profiling with live scoped authorization. Never approves a writer.
import {createHash,randomUUID} from 'node:crypto';
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {AuthService,type Membership,type Principal} from '../src/auth/service.js';
import {buildServer} from '../src/server.js';
import type {Repository} from '../src/db/contract.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

async function main(){
 const [userId,authSessionId,contextId,expiry]=process.argv.slice(2),expiresAt=Number(expiry);
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!uuid.test(userId||'')||!uuid.test(authSessionId||'')||!contextId||!Number.isFinite(expiresAt)||expiresAt<Date.now()+60000)throw new Error('Active identity arguments required');
 const config=loadConfig();
 if(!config.supabase||!['watsonx','gemini','openai'].includes(config.agentProvider||''))throw new Error('Configured model and Supabase required');
 const gateway=new SupabaseGateway(config.supabase),auth=new AuthService(gateway);
 const membership=await gateway.call<Membership>('profile.get',{user_id:userId});
 const principal:Principal={userId,sessionId:authSessionId,expiresAt,token:'',membership};
 auth.active(principal);await auth.stillAuthorized(userId,authSessionId,contextId);
 const calls:any[]=[],methods:any[]=[],events:any[]=[],started=performance.now();
 const dispatch=gateway.call.bind(gateway);
 gateway.call=async<T>(action:string,args:Record<string,unknown>={})=>{
  const at=performance.now();let success=false;
  try{const result=await dispatch<T>(action,args);success=true;return result;}
  finally{calls.push({action,...(typeof args.kind==='string'?{kind:args.kind}:{}),at_ms:Math.round(at-started),duration_ms:Math.round(performance.now()-at),success});}
 };
 const repository=new SupabaseRepository(gateway);
 const repo=new Proxy(repository,{get(target,key){const original=Reflect.get(target,key);if(typeof original!=='function')return original;
  return async(...args:any[])=>{const at=performance.now();try{return await original.apply(target,args);}finally{methods.push({method:String(key),at_ms:Math.round(at-started),duration_ms:Math.round(performance.now()-at)});}};
 }}) as Repository;
 let server:Awaited<ReturnType<typeof buildServer>>|undefined,sessionId:string|undefined;
 try{
  server=await buildServer({config,repo,auth});
  const session=await repo.createSession(contextId);sessionId=session.session_id;await repository.bindSession(sessionId,userId,config.supabase.organizationId);
  const report='Laporan Posko Uji Latensi Metadata di Desa Uji: 10 jiwa, laki-laki 4, perempuan 6. Semua berusia dewasa. Stok air bersih 200 liter untuk 24 jam.';
  const batch=await repo.createBatch({sessionId,contextId,requestId:randomUUID(),sourceSha256:createHash('sha256').update(report).digest('hex'),sourceLength:Buffer.byteLength(report),filteredText:report,piiSummary:{}});
  server.orchestrator.setPrincipal(sessionId,principal);
  server.orchestrator.on('event',event=>{events.push({type:event.event_type,stage:event.payload?.stage,at_ms:Math.round(performance.now()-started)});});
  const processing=performance.now();
  await server.orchestrator.processBatchMessage({sessionId,batchId:batch.batch_id,requestId:batch.request_id,contextId,filteredText:report,firstTurn:true});
  const processingMs=Math.round(performance.now()-processing),result=await repo.getBatch(batch.batch_id);
  const preview=JSON.parse(result?.preview_payload_json||'null'),gap=JSON.parse(result?.gap_payload_json||'null');
  const measurement={synthetic:true,operational_write:false,processing_ms:processingMs,status:result?.status,records:preview?.records?.length,people:preview?.records?.[0]?.total_people,water_l_per_day:gap?.shelters?.[0]?.needs?.air_liter_per_hari?.value,calls,methods,events};
  mkdirSync(resolve('../ref'),{recursive:true});
  const path=resolve('../ref/pipeline-metadata-'+Date.now()+'.json');writeFileSync(path,JSON.stringify(measurement,null,2));
  console.log(JSON.stringify({artifact:path,...measurement},null,2));
  if(result?.status!=='ready_for_review'||preview?.records?.[0]?.total_people!==10)throw new Error('Synthetic review result not verified');
 }finally{
  try{await server?.app.close();}finally{
   if(sessionId){
    const closed=await dispatch<any>('entity.patch',{kind:'sessions',id:sessionId,patch:{status:'closed'},expected:{status:'active',owner_user_id:userId}});
    if(closed?.status!=='closed')throw new Error('Diagnostic session cleanup failed');
   }
  }
 }
}
main().catch(error=>{console.error('Pipeline profiling failed: '+(error instanceof Error?error.message:'unknown'));process.exitCode=1;});
