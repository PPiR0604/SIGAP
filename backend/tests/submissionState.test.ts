import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import type {Repository} from '../src/db/contract.js';
import type {BatchRecord} from '../src/db/repo.js';

class LegacyGateway extends SupabaseGateway {
 entities=new Map<string,any>();batchLists=0;
 constructor(){super({url:'https://example.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'fixture'});}
 override async call<T>(action:string,args:any):Promise<T>{
  if(action==='entity.put'){this.entities.set(args.kind+':'+args.id,structuredClone(args.document));return structuredClone(args.document);}
  if(action==='entity.patch'){const key=args.kind+':'+args.id,old=this.entities.get(key);const value=old?{...old,...args.patch}:null;if(value)this.entities.set(key,value);return structuredClone(value);}
  if(action==='entity.get')return structuredClone(this.entities.get(args.kind+':'+args.id)??null);
  if(action==='entity.list'){
   if(args.kind==='batches')this.batchLists++;
   return structuredClone([...this.entities.entries()].filter(([key,value])=>key.startsWith(args.kind+':')&&Object.entries(args.filter??{}).every(([k,v])=>value[k]===v)).map(([,v])=>v)) as T;
  }
  throw Error('Unexpected fixture action');
 }
}
for(const mode of ['sqlite','legacy-cloud'] as const)test(`submission checks preserve retry priority, active state and first-turn isolation (${mode})`,async()=>{
 const gateway=new LegacyGateway(),repo:Repository=mode==='sqlite'?new SigapRepository():new SupabaseRepository(gateway);
 try{
  const mine=await repo.createSession(),other=await repo.createSession();
  const create=(session:typeof mine,requestId:string)=>repo.createBatch({sessionId:session.session_id,contextId:session.context_id,requestId,sourceSha256:'hash',sourceLength:1,filteredText:'synthetic',piiSummary:{}});
  await create(other,'same-request');
  assert.deepEqual(await repo.getSubmissionState(mine.session_id,'same-request'),{existingBatch:null,activeBatchId:null,firstTurn:true});
  const previous=await create(mine,'same-request');await repo.updateBatchStatus(previous.batch_id,'ready_for_review');
  const active=await create(mine,'later');
  for(const status of ['processing','saving','verifying']){
   await repo.updateBatchStatus(active.batch_id,status);
   gateway.batchLists=0;
   const retry=await repo.getSubmissionState(mine.session_id,'same-request');
   assert.equal(retry.existingBatch?.batch_id,previous.batch_id);assert.equal(retry.activeBatchId,active.batch_id);assert.equal(retry.firstTurn,false);
   if(mode==='legacy-cloud')assert.equal(gateway.batchLists,1,'One response must supply all three checks');
  }
  await repo.updateBatchStatus(active.batch_id,'done');
  assert.deepEqual(await repo.getSubmissionState(mine.session_id,'new'),{existingBatch:null,activeBatchId:null,firstTurn:false});
 }finally{await repo.close();}
});

test('bounded submission response is session/request-bound and rejects malformed state',async()=>{
 const gateway=new LegacyGateway(),repo=new SupabaseRepository(gateway);
 const batch={batch_id:'mine-batch',session_id:'mine',request_id:'mine:retry'} as BatchRecord;
 let result:any={existingBatch:batch,activeBatchId:'active',firstTurn:false},calls=0;
 gateway.call=async(action,args)=>{calls++;assert.equal(action,'entity.list');assert.deepEqual(args,{kind:'batches',filter:{session_id:'mine'},submission_state:true,request_id:'mine:retry'});return structuredClone(result);};
 assert.deepEqual(await repo.getSubmissionState('mine','retry'),result);assert.equal(calls,1);
 for(const bad of [null,{}, {existingBatch:null,activeBatchId:null,firstTurn:0},
  {existingBatch:{...batch,session_id:'foreign'},activeBatchId:null,firstTurn:false},
  {existingBatch:{...batch,request_id:'mine:other'},activeBatchId:null,firstTurn:false},
  {existingBatch:null,activeBatchId:42,firstTurn:false},
  {existingBatch:null,activeBatchId:'active',firstTurn:true},
  {existingBatch:batch,activeBatchId:null,firstTurn:true}]){
  result=bad;await assert.rejects(repo.getSubmissionState('mine','retry'),/Invalid submission state/);
 }
});
