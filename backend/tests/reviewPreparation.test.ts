import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {SupabaseGateway} from '../src/supabase/client.js';

const snapshotId='1'.repeat(32),hash='a'.repeat(64);
function fixture(){
 const repo=new SigapRepository(),session=repo.createSession();
 const batch=repo.createBatch({sessionId:session.session_id,contextId:session.context_id,requestId:'review',sourceSha256:'source',sourceLength:1,filteredText:'synthetic',piiSummary:{}});
 const payload={snapshot_id:snapshotId,snapshot_sha256:hash,records:[{report_id:'R001',total_people:0,male:null}],issues:[]};
 const input={sessionId:session.session_id,batchId:batch.batch_id,snapshotId,snapshotSha256:hash,qualityStatus:'PERLU_KLARIFIKASI',payload};
 return {repo,session,batch,input};
}

test('new review atomically creates snapshot/preview; replay cannot overwrite payload or timestamps',()=>{
 const {repo,batch,input}=fixture();try{
  const first=repo.getOrCreateReviewSnapshot(input);
  assert.equal(first.created,true);assert.equal(first.snapshot.version,1);
  const ready=repo.getBatch(batch.batch_id)!;
  assert.equal(ready.status,'ready_for_review');assert.equal(ready.preview_payload_json,JSON.stringify(input.payload));
  const replay=repo.getOrCreateReviewSnapshot({...input,payload:{...input.payload,records:[{total_people:999}]}});
  assert.equal(replay.created,false);assert.deepEqual({...replay.snapshot},first.snapshot);
  assert.deepEqual(repo.getBatch(batch.batch_id),ready);
  const next=repo.getOrCreateReviewSnapshot({...input,snapshotId:'2'.repeat(32),payload:{...input.payload,snapshot_id:'2'.repeat(32)}});
  assert.equal(next.snapshot.version,2);
 }finally{repo.close();}
});

test('foreign sessions and terminal/saving batches cannot be changed by review preparation',()=>{
 const {repo,batch,input}=fixture();try{
  assert.throws(()=>repo.getOrCreateReviewSnapshot({...input,sessionId:'other'}),/not editable|outside session/);
  for(const status of ['saving','verifying','done','failed','payload_invalid']){
   repo.updateBatchStatus(batch.batch_id,status);
   assert.throws(()=>repo.getOrCreateReviewSnapshot(input),/editable/);
   assert.equal(repo.getSnapshot(snapshotId),null);assert.equal(repo.getBatch(batch.batch_id)!.status,status);
  }
 }finally{repo.close();}
});

test('batch update failure rolls back the new snapshot, preserving the original batch',()=>{
 const {repo,batch,input}=fixture();try{
  const before=repo.getBatch(batch.batch_id);repo.updateBatchStatus=()=>{throw Error('Batch write failed');};
  assert.throws(()=>repo.getOrCreateReviewSnapshot(input),/Batch write failed/);
  assert.equal(repo.getSnapshot(snapshotId),null);assert.deepEqual(repo.getBatch(batch.batch_id),before);
 }finally{repo.close();}
});

test('cloud review uses one bounded RPC and rejects a changed or malformed new snapshot',async()=>{
 const input={sessionId:'session',batchId:'batch',snapshotId,snapshotSha256:hash,qualityStatus:'OK',payload:{snapshot_id:snapshotId,snapshot_sha256:hash,records:[{total_people:0}]}};
 const gateway=new SupabaseGateway({url:'https://fixture.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'fixture'});
 const calls:any[]=[];
 gateway.call=async(_action,args:any)=>{calls.push({_action,args});return {created:true,snapshot:args.snapshot} as any;};
 const repo=new SupabaseRepository(gateway),result=await repo.getOrCreateReviewSnapshot(input);
 assert.equal(calls.length,1);assert.equal(calls[0]._action,'review.prepare');
 assert.equal(result.snapshot.payload_json,JSON.stringify(input.payload));
 for(const value of [null,{}, {created:true,snapshot:{...result.snapshot,batch_id:'foreign'}},{created:true,snapshot:{...result.snapshot,payload_json:'{}'}}]){
  gateway.call=async()=>value as any;
  await assert.rejects(repo.getOrCreateReviewSnapshot(input),/review preparation|Review preparation/);
 }
});
