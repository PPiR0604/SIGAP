import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import type {AgentRuntime,AgentPromptOptions} from '../src/acp/types.js';
import {correctionInput} from '../src/pipeline/corrections.js';

const snapshot='2'.repeat(32),sha='b'.repeat(64);
const row={batch_id:'old-batch',report_id:'R002',shelter_name:'Posko Harapan',village:null,total_people:98,male:45,female:55};

async function prepare(records:any[],text:string,prior:boolean|'new'=false,priorRecords?:any[]){
  const repo=new SigapRepository(':memory:');
  const session=repo.createSession('test');
  const priorId='3'.repeat(32),priorSha='d'.repeat(64);
  let approvalId:string|undefined;
  let previousBatchId:string|undefined;
  if(prior){
    const previous=repo.createBatch({sessionId:session.session_id,requestId:'prior',contextId:'test',sourceSha256:'a'.repeat(64),sourceLength:1,filteredText:'old',piiSummary:{}});
    previousBatchId=previous.batch_id;
    repo.saveSnapshot({snapshotId:priorId,snapshotSha256:priorSha,batchId:previous.batch_id,version:1,qualityStatus:'PARSIAL',payload:{records:priorRecords??[{...row,batch_id:prior==='new'?'old-batch':'draft',male:43,elderly:16,...(prior==='new'?{}:{update_target:{...row,expected:{}}})}]}});
    repo.updateBatchStatus(previous.batch_id,'ready_for_review');
    approvalId=repo.createApproval({batchId:previous.batch_id,actorId:'test',action:'approve_save',snapshotId:priorId,snapshotSha256:priorSha,partialScope:{partial_acknowledged:true},clearDecisions:{}}).approval_id;
  }
  const batch=repo.createBatch({sessionId:session.session_id,requestId:'correction',contextId:'test',sourceSha256:'c'.repeat(64),sourceLength:text.length,filteredText:text,piiSummary:{}});
  let dispatched:AgentPromptOptions|undefined;
  const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
    readStoredRekap:async()=>({content:[{type:'text',text:JSON.stringify({status:'ok',snapshot_id:snapshot,snapshot_sha256:sha,records})}]}),
    sendPrompt:async(options,onEvent)=>{dispatched=options;onEvent({session_id:session.session_id,batch_id:batch.batch_id,event_type:prior?'preview_ready':'assistant_message',payload:prior?{rawOutput:JSON.stringify({snapshot_id:'4'.repeat(32),snapshot_sha256:'e'.repeat(64),records:[{...row,male:43,elderly:17,update_target:{...row,expected:{}}}],issues:[]})}:{text:'Pratinjau'},timestamp:new Date().toISOString()});}};
  const orchestrator=new BatchOrchestrator(repo,runtime);
  await orchestrator.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'test',filteredText:text});
  const status=repo.getBatch(batch.batch_id)!.status;
  const events=repo.getEventsAfter(session.session_id).map(e=>({type:e.event_type,payload:JSON.parse(e.payload_json)}));
  const previousSuperseded=repo.getSnapshot(priorId)?.superseded_by;
  const previousApproval=approvalId?(repo.hasApprovalForSnapshot(previousBatchId!,priorId)?'pending':'revoked'):undefined;
  repo.close();return {dispatched,status,events,previousSuperseded,previousApproval};
}

test('correction binds original text to a read-back row even when village is unknown',async()=>{
  const text='Mohon klarifikasi laporan R002 (Posko Harapan): laki lakinya 43 dan lansianya 16';
  const result=await prepare([row],text);
  assert.ok(result.dispatched);
  const input=JSON.parse(result.dispatched.filteredText!);
  assert.equal(input.report_text,text);
  assert.deepEqual(input.correction_target,{snapshot_id:snapshot,snapshot_sha256:sha,record_index:0});
  assert.ok(result.dispatched.prompt.includes(JSON.stringify(input)));
});

test('ambiguous and missing correction targets stop before report processing',async()=>{
  for(const records of [[row,{...row,batch_id:'other-batch'}],[]]){
    const result=await prepare(records,'Koreksi laporan R002 (Posko Harapan): laki-laki 43');
    assert.equal(result.dispatched,undefined);
    assert.equal(result.status,'failed');
    assert.ok(result.events.some(e=>e.type==='error'&&e.payload.code==='CORRECTION_TARGET_INVALID'));
  }
});

test('ordinary questions mentioning clarification do not create corrections',async()=>{
  const text='Kenapa laporan R002 perlu klarifikasi?';
  const result=await prepare([row],text);
  assert.equal(result.dispatched?.filteredText,text);
});

test('a second draft continues pending correction and revokes the previous candidate approval',async()=>{
  const result=await prepare([row],'Koreksi laporan R002 (Posko Harapan): lansianya 17',true);
  const input=JSON.parse(result.dispatched!.filteredText!);
  assert.deepEqual(input.candidate_target,{snapshot_id:'3'.repeat(32),snapshot_sha256:'d'.repeat(64),record_index:0});
  assert.equal(result.previousSuperseded,'4'.repeat(32));
  assert.equal(result.previousApproval,'revoked');
  assert.deepEqual(result.events.find(event=>event.type==='preview_ready')?.payload.superseded_snapshot_ids,['3'.repeat(32)]);
});

test('clarification can edit an unsaved candidate when storage is empty',async()=>{
  const result=await prepare([],'Mohon klarifikasi laporan R002 (Posko Harapan): laki lakinya 43 lansianya 16','new');
  assert.ok(result.dispatched);
  const input=JSON.parse(result.dispatched.filteredText!);
  assert.deepEqual(input.candidate_target,{snapshot_id:'3'.repeat(32),snapshot_sha256:'d'.repeat(64),record_index:0});
  assert.equal(result.status,'ready_for_review');
});

test('original batch resolves the latest candidate through bound identity pairs',()=>{
  const oldBatch='a'.repeat(32);
  const candidate={...row,batch_id:'b'.repeat(32),candidate_lineage:[{batch_id:oldBatch,report_id:'R002'}]};
  const input=JSON.parse(correctionInput(`Koreksi laporan R002 (Posko Harapan) batch ${oldBatch}: lansianya 17`,{status:'ok',snapshot_id:snapshot,snapshot_sha256:sha,records:[candidate]},true));
  assert.equal(input.correction_target.record_index,0);
  assert.throws(()=>correctionInput(`Koreksi laporan R003 (Posko Harapan) batch ${oldBatch}: lansianya 17`,{status:'ok',snapshot_id:snapshot,snapshot_sha256:sha,records:[candidate]},true),/hilang/);
  assert.throws(()=>correctionInput(`Koreksi laporan R002 (Posko Harapan) batch ${oldBatch}: lansianya 17`,{status:'ok',snapshot_id:snapshot,snapshot_sha256:sha,records:[candidate,candidate]},true),/ambigu/);
});

test('ambiguous candidate never falls back to a uniquely matching stored row',async()=>{
  const result=await prepare([row],'Koreksi laporan R002 (Posko Harapan): lansianya 17','new',[row,{...row,batch_id:'other'}]);
  assert.equal(result.dispatched,undefined);
  assert.equal(result.status,'failed');
  assert.equal(result.previousSuperseded,null);
  assert.equal(result.previousApproval,'pending');
});

test('a correction cannot silently replace a multi-village candidate with one village',async()=>{
  const result=await prepare([],'Mohon klarifikasi laporan R002 (Posko Harapan): lansia: 17','new',
    [row,{...row,report_id:'R003',shelter_name:'Posko Lain',village:'Desa Lain',urgent_needs:['beras']}]);
  assert.equal(result.status,'payload_invalid');
  assert.equal(result.previousSuperseded,null);
  assert.ok(result.events.some(event=>event.type==='error'&&event.payload.code==='PAYLOAD_INVALID'));
});
