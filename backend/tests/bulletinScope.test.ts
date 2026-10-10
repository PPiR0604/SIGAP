import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import type {AgentRuntime,AgentPromptOptions} from '../src/acp/types.js';
import {isStoredBulletinRequest} from '../src/pipeline/bulletin.js';

const currentId='6'.repeat(32),currentSha='f'.repeat(64),oldId='1'.repeat(32),oldSha='a'.repeat(64);
const records=[{report_id:'R001',shelter_name:'Posko A',village:'Desa A',total_people:91,urgent_needs:['air bersih']},
  {report_id:'R002',shelter_name:'Posko Harapan',total_people:98,urgent_needs:[]}];

test('whole-rekap bulletin reads all shelters and refuses a prior single-shelter snapshot',async()=>{
  const repo=new SigapRepository(':memory:');
  const session=repo.createSession('test');
  const text='Tolong susun draf buletin donatur dari rekap yang ada saat ini. Hanya pratinjau (action preview), jangan membuat dokumen.';
  const batch=repo.createBatch({sessionId:session.session_id,requestId:'bulletin',contextId:'test',sourceSha256:'a'.repeat(64),sourceLength:text.length,filteredText:text,piiSummary:{}});
  let reads=0;let dispatched:AgentPromptOptions|undefined;let staleAllowed:boolean|undefined;
  const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
    readStoredRekap:async()=>{reads++;return {content:[{type:'text',text:JSON.stringify({status:'ok',total_shelters:2,matched_shelters:2,snapshot_id:currentId,snapshot_sha256:currentSha,records})}]};},
    sendPrompt:async(options,onEvent,gate)=>{
      dispatched=options;
      staleAllowed=(await gate!(options.sessionId,{toolName:'sigap_6_draft_bulletin',args:{input_value:JSON.stringify({action:'preview',snapshot_id:oldId,snapshot_sha256:oldSha})},toolCallId:'old'})).allow;
      const allowed=await gate!(options.sessionId,{toolName:'sigap_6_draft_bulletin',args:{input_value:JSON.stringify({action:'preview',snapshot_id:currentId,snapshot_sha256:currentSha})},toolCallId:'current'});
      assert.equal(allowed.allow,true);
      onEvent({session_id:session.session_id,batch_id:batch.batch_id,event_type:'bulletin_ready',timestamp:new Date().toISOString(),payload:{rawOutput:JSON.stringify({action:'create_doc',content:'DRAF\n- air bersih',content_sha256:'c'.repeat(64),preview_at:'2026-10-09T23:48:00',confirmed_create_doc:false,snapshot_id:currentId,snapshot_sha256:currentSha,records})}});
      onEvent({session_id:session.session_id,batch_id:batch.batch_id,event_type:'assistant_message',timestamp:new Date().toISOString(),payload:{text:'Pratinjau buletin tersedia.'}});
    }};
  try{
    await new BatchOrchestrator(repo,runtime).processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'test',filteredText:text});
    assert.equal(reads,1);
    assert.equal(staleAllowed,false);
    assert.ok(dispatched?.prompt.includes(currentId));
    const payload=JSON.parse(repo.getBatch(batch.batch_id)!.bulletin_payload_json!);
    assert.equal(payload.records.length,2);
    assert.deepEqual(payload.records[0].urgent_needs,['air bersih']);
    assert.equal(repo.getBatch(batch.batch_id)!.status,'conversation_done');
  }finally{repo.close();}
});

test('questions and explicit candidate bulletin requests keep their existing scope',()=>{
  assert.equal(isStoredBulletinRequest('Kenapa buletin dari rekap hanya satu posko?'),false);
  assert.equal(isStoredBulletinRequest('Tolong susun buletin dari kandidat Posko Harapan saja.'),false);
  assert.equal(isStoredBulletinRequest('Buat draf buletin dari kandidat rekap ini saja'),false);
  assert.equal(isStoredBulletinRequest('Tolong buat buletin dari seluruh rekap, jangan pakai kandidat koreksi.'),true);
});

test('natural permission phrasing still requests the entire stored rekap',()=>{
  assert.equal(isStoredBulletinRequest('Bisa buat buletin dari seluruh rekap tersimpan?'),true);
});

test('unavailable or incomplete full-rekap read stops before bulletin generation',async()=>{
  for(const readback of [null,{content:[{type:'text',text:JSON.stringify({status:'ok',total_shelters:6,snapshot_id:currentId,snapshot_sha256:currentSha,records})}]}]){
    const repo=new SigapRepository(':memory:');const session=repo.createSession('test');
    const text='Tolong susun buletin dari seluruh rekap.';
    const batch=repo.createBatch({sessionId:session.session_id,requestId:'missing',contextId:'test',sourceSha256:oldSha,sourceLength:text.length,filteredText:text,piiSummary:{}});
    let called=false;
    const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},readStoredRekap:async()=>readback,
      sendPrompt:async()=>{called=true;}};
    try{
      await new BatchOrchestrator(repo,runtime).processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:'missing',contextId:'test',filteredText:text});
      assert.equal(called,false);assert.equal(repo.getBatch(batch.batch_id)!.status,'failed');
      assert.ok(repo.getEventsAfter(session.session_id).some(e=>e.event_type==='error'&&JSON.parse(e.payload_json).code==='BULLETIN_SOURCE_INVALID'));
    }finally{repo.close();}
  }
});
