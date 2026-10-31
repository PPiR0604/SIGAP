import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import type {AgentRuntime} from '../src/acp/types.js';

test('public preview calculation uses only the original bulletin snapshot and validates its full scope',async()=>{
 const repo=new SigapRepository(':memory:');
 const session=repo.createSession('test'),reference={snapshot_id:'1'.repeat(32),snapshot_sha256:'a'.repeat(64)};
 const record={shelter_name:'Posko A',village:'A',total_people:10};
 const batch=repo.createBatch({sessionId:session.session_id,requestId:'publication',contextId:'test',sourceSha256:'a',sourceLength:1,filteredText:'test',piiSummary:{}});
 repo.updateBatchStatus(batch.batch_id,'conversation_done',{bulletin_payload_json:JSON.stringify({source_metadata:{...reference,records:[record]}})});
 let mismatched=false,missing=false,calls=0;
 const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},sendPrompt:async()=>assert.fail('Public review must never call a model'),
  calculateNeedsForSnapshot:async(_session,ref,signal)=>{calls++;assert.deepEqual(ref,reference);assert.ok(signal instanceof AbortSignal);return {content:[{type:'text',text:JSON.stringify({...reference,...(mismatched?{snapshot_id:'2'.repeat(32)}:{}),totals:{},shelters:missing?[]:[{...record,priority:'RENDAH',needs:{air_liter_per_hari:{value:150}},gaps:{}}]})}]};}};
 const orchestrator=new BatchOrchestrator(repo,runtime);
 try{
  const result=await orchestrator.readBulletinCalculation(repo.getBatch(batch.batch_id)!);assert.equal(result.shelters[0].needs.air_liter_per_hari.value,150);assert.equal(calls,1);
  mismatched=true;await assert.rejects(orchestrator.readBulletinCalculation(repo.getBatch(batch.batch_id)!),/snapshot/);
  mismatched=false;missing=true;await assert.rejects(orchestrator.readBulletinCalculation(repo.getBatch(batch.batch_id)!),/seluruh posko/);
  assert.equal(repo.countBatches(session.session_id),1);assert.deepEqual(repo.getEventsAfter(session.session_id),[]);
 }finally{await orchestrator.shutdown();repo.close();}
});
