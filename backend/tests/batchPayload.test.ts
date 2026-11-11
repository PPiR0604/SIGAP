import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import type {Repository} from '../src/db/contract.js';

class Gateway extends SupabaseGateway {
 entities=new Map<string,any>();payloadPatches=0;beforePayloadPatch?:()=>void;
 constructor(){super({url:'https://example.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'fixture'});}
 override async call<T>(action:string,args:any):Promise<T>{
  const key=args.kind+':'+args.id;
  if(action==='entity.get')return structuredClone(this.entities.get(key)??null) as T;
  if(action==='entity.put'){this.entities.set(key,structuredClone(args.document));return structuredClone(args.document);}
  if(action==='entity.patch'){
   if(args.kind==='batches'&&!('status' in args.patch)){
    this.payloadPatches++;this.beforePayloadPatch?.();this.beforePayloadPatch=undefined;
    assert.equal(args.patch.latest_snapshot_id,undefined,'Payload updates must not alter a snapshot reference');
   }
   const old=this.entities.get(key);if(!old)return null as T;
   const value={...old,...args.patch};this.entities.set(key,value);return structuredClone(value);
  }
  throw new Error('Unexpected action');
 }
}
for(const mode of ['sqlite','cloud'] as const)test(`review preview and payload updates preserve current batch state (${mode})`,async()=>{
 const gateway=new Gateway(),repo:Repository=mode==='sqlite'?new SigapRepository():new SupabaseRepository(gateway);
 try{
  const session=await repo.createSession(),batch=await repo.createBatch({sessionId:session.session_id,contextId:session.context_id,requestId:'payload',sourceSha256:'a',sourceLength:1,filteredText:'synthetic',piiSummary:{}});
  const payload={snapshot_id:'1'.repeat(32),snapshot_sha256:'a'.repeat(64),records:[{report_id:'R001',total_people:10}],issues:[]};
  const snapshot=await repo.saveSnapshot({snapshotId:payload.snapshot_id,snapshotSha256:payload.snapshot_sha256,batchId:batch.batch_id,version:1,qualityStatus:'OK',payload});
  const ready=(await repo.getBatch(batch.batch_id))!;
  assert.equal(ready.status,'ready_for_review');assert.equal(ready.preview_payload_json,snapshot.payload_json);
  assert.equal(ready.latest_snapshot_id,snapshot.snapshot_id);assert.equal(ready.latest_snapshot_sha256,snapshot.snapshot_sha256);
  for(const status of ['saving','done','failed']){
   await repo.updateBatchStatus(batch.batch_id,status);
   await repo.updateBatchPayload(batch.batch_id,{gap_payload_json:'{"current":true}',status:'processing',latest_snapshot_id:'altered'} as any);
   const result=(await repo.getBatch(batch.batch_id))!;
   assert.equal(result.status,status);assert.equal(result.latest_snapshot_id,snapshot.snapshot_id);
   assert.equal(result.preview_payload_json,snapshot.payload_json);assert.equal(result.gap_payload_json,'{"current":true}');
  }
  await assert.rejects(async()=>repo.updateBatchPayload('missing',{bulletin_payload_json:'{}'}),/Batch not found/);
 }finally{await repo.close();}
});

test('a completion committed while a cloud payload update is in flight cannot be reverted',async()=>{
 const gateway=new Gateway(),repo=new SupabaseRepository(gateway);
 const session=await repo.createSession(),batch=await repo.createBatch({sessionId:session.session_id,contextId:session.context_id,requestId:'race',sourceSha256:'a',sourceLength:1,filteredText:'synthetic',piiSummary:{}});
 gateway.beforePayloadPatch=()=>{gateway.entities.get('batches:'+batch.batch_id).status='done';};
 await repo.updateBatchPayload(batch.batch_id,{bulletin_payload_json:'{"approved_source":"unchanged"}'});
 assert.equal((await repo.getBatch(batch.batch_id))!.status,'done');assert.equal(gateway.payloadPatches,1);
});
