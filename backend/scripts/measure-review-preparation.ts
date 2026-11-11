// Review-metadata-only maintenance measurement. No model, MCP or canonical save.
import '../src/config.js';
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {AuthService} from '../src/auth/service.js';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const [userId,authSessionId,contextId]=process.argv.slice(2);
if(!/^[a-f0-9-]{36}$/i.test(userId||'')||!/^[a-f0-9-]{36}$/i.test(authSessionId||'')||!contextId)throw Error('Existing active identity and context required.');
const settings=loadConfig().supabase;if(!settings)throw Error('Supabase required.');
const gateway=new SupabaseGateway(settings),auth=new AuthService(gateway),repo=new SupabaseRepository(gateway);
await auth.stillAuthorized(userId,authSessionId,contextId);
const session=await repo.createSession(contextId);await repo.bindSession(session.session_id,userId,settings.organizationId);
const original=gateway.call.bind(gateway),samples:any[]=[];let calls:any[]|undefined,currentBatch:string|undefined;
gateway.call=async<T>(action:string,args:Record<string,unknown>={})=>{const started=performance.now();try{return await original<T>(action,args);}finally{calls?.push({action,kind:args.kind,ms:Math.round(performance.now()-started)});}};
try{
 for(const mode of ['legacy','combined','combined','legacy']){
  await auth.stillAuthorized(userId,authSessionId,contextId);
  const batch=await repo.createBatch({sessionId:session.session_id,contextId,requestId:randomUUID(),sourceSha256:createHash('sha256').update('synthetic metadata fixture').digest('hex'),sourceLength:1,filteredText:'Synthetic metadata measurement only; not a shelter report.',piiSummary:{}});currentBatch=batch.batch_id;
  const snapshotId=randomBytes(16).toString('hex'),snapshotSha256=createHash('sha256').update('metadata fixture '+snapshotId).digest('hex');
  const payload={snapshot_id:snapshotId,snapshot_sha256:snapshotSha256,records:[{report_id:'R001',shelter_name:'Synthetic metadata fixture',total_people:0,male:null}],issues:[]};
  const input={sessionId:session.session_id,batchId:batch.batch_id,snapshotId,snapshotSha256,qualityStatus:'PERLU_KLARIFIKASI',payload};
  const started=performance.now();calls=[];
  if(mode==='legacy'){
   const [existing,current]=await Promise.all([repo.getSnapshot(snapshotId),repo.getBatch(batch.batch_id)]);
   assert.equal(existing,null);await repo.saveSnapshot({...input,version:current?.latest_snapshot_id?2:1});
  }else assert.equal((await repo.getOrCreateReviewSnapshot(input)).created,true);
  await repo.supersedePreviousSnapshots(batch.batch_id,snapshotId);
  samples.push({mode,ms:Math.round(performance.now()-started),gateway_calls:calls});calls=undefined;
  const stored=(await repo.getSnapshot(snapshotId))!,ready=(await repo.getBatch(batch.batch_id))!;
  assert.deepEqual(JSON.parse(stored.payload_json),payload);assert.equal(ready.preview_payload_json,stored.payload_json);assert.equal(ready.status,'ready_for_review');
  const replay=await repo.getOrCreateReviewSnapshot({...input,payload:{...payload,records:[{report_id:'R001',total_people:999}]}});
  assert.equal(replay.created,false);assert.deepEqual(replay.snapshot,stored);assert.deepEqual(await repo.getBatch(batch.batch_id),ready);
  currentBatch=undefined;
 }
}finally{
 if(currentBatch)await repo.updateBatchStatus(currentBatch,'failed');
 const closed=await original<any>('entity.patch',{kind:'sessions',id:session.session_id,patch:{status:'closed'},expected:{status:'active',owner_user_id:userId}});
 if(closed?.status!=='closed')throw Error('Diagnostic session cleanup failed.');
}
const result={synthetic:true,metadata_only:true,operational_write:false,model_calls:0,mcp_calls:0,diagnostic_session_closed:true,samples};
writeFileSync('../ref/review-preparation-latency.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
