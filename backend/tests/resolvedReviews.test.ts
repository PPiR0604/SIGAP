import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewAlreadyStored} from '../src/pipeline/resolvedReviews.js';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import type {AgentRuntime} from '../src/acp/types.js';

const draft={shelter_name:'Sejahtera',village:'Cibening',shelter_id:'provisional',storage_baseline:{row:null},
  report_id:'R002',batch_id:'old-source',total_people:32,male:15,female:17,reported_at:'2026-11-10 08:02',
  stock:{air_liter_per_hari:0},stock_context:{air_liter_per_hari:{unit:'L',recorded_at:'2026-11-10 08:02',horizon_hours:24}},
  urgent_needs:[{item:'air bersih',qty:null,unit:null}],notes:null};
const saved={...draft,shelter_id:'persisted',batch_id:'new-source',report_id:'R001',reported_at:'2026-11-10T08:02',
  notes:'',urgent_needs:['air bersih'],stock_context:{air_liter_per_hari:{unit:'L',recorded_at:'2026-11-10T08:02',horizon_hours:24}}};

test('the same approved values resolve a redundant draft despite new source IDs and allocated shelter ID',()=>{
  assert.equal(reviewAlreadyStored([draft],[saved]),true);
  assert.equal(reviewAlreadyStored([draft],[{...saved,shelter_name:'Posko Sejahtera'}]),true);
  assert.equal(reviewAlreadyStored([],[]),false);
});

test('different villages, actual values, unknown stock and unresolved decisions keep their own review',()=>{
  for(const change of [{village:'Karangmulya'},{male:16},{total_people:40},{notes:'Masih perlu diperiksa'},
    {stock:{air_liter_per_hari:null}},{stock_context:{air_liter_per_hari:{unit:'L',recorded_at:'2026-11-10 08:00',horizon_hours:24}}},
    {urgent_needs:['air bersih','selimut']},{reported_at:'2026-11-10 08:20'}]){
    assert.equal(reviewAlreadyStored([draft],[{...saved,...change}]),false,JSON.stringify(change));
  }
  for(const field of ['pending_clear_fields','validation_issues','unverified_numbers','stock_issues','storage_issues','storage_conflicts'])
    assert.equal(reviewAlreadyStored([{...draft,[field]:['review']}],[saved]),false,field);
  assert.equal(reviewAlreadyStored([{...draft,update_target:{shelter_id:'existing'}}],[saved]),false);
  assert.equal(reviewAlreadyStored([{...draft,storage_baseline:{row:{posko:'existing'}}}],[saved]),false);
  assert.equal(reviewAlreadyStored([draft],[saved,saved]),false,'ambiguous matching records');
});

test('fresh stored read retires only identical pending snapshots and reports their batch IDs to UI',async()=>{
  const repo=new SigapRepository(':memory:');
  const session=repo.createSession();
  try{
    const old=repo.createBatch({sessionId:session.session_id,contextId:session.context_id,requestId:'old',sourceSha256:'hash',sourceLength:1,filteredText:'x',piiSummary:{}});
    repo.saveSnapshot({snapshotId:'1'.repeat(32),snapshotSha256:'a'.repeat(64),batchId:old.batch_id,version:1,qualityStatus:'PARSIAL',payload:{records:[draft]}});
    repo.updateBatchStatus(old.batch_id,'ready_for_review');
    const other=repo.createBatch({sessionId:session.session_id,contextId:session.context_id,requestId:'different',sourceSha256:'hash',sourceLength:1,filteredText:'x',piiSummary:{}});
    repo.saveSnapshot({snapshotId:'2'.repeat(32),snapshotSha256:'b'.repeat(64),batchId:other.batch_id,version:1,qualityStatus:'PARSIAL',payload:{records:[{...draft,total_people:40}]}});
    repo.updateBatchStatus(other.batch_id,'ready_for_review');
    const read=repo.createBatch({sessionId:session.session_id,contextId:session.context_id,requestId:'read',sourceSha256:'hash',sourceLength:1,filteredText:'x',piiSummary:{}});
    const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
      sendPrompt:async(options,onEvent)=>{await onEvent({session_id:session.session_id,batch_id:read.batch_id,event_type:'readback_result',timestamp:new Date().toISOString(),payload:{rawOutput:JSON.stringify({status:'ok',snapshot_id:'3'.repeat(32),snapshot_sha256:'c'.repeat(64),records:[saved]})}});}};
    const orchestrator=new BatchOrchestrator(repo,runtime);
    await orchestrator.processBatchMessage({sessionId:session.session_id,batchId:read.batch_id,contextId:session.context_id,requestId:'read',filteredText:'Baca rekap tersimpan'});
    assert.equal(repo.getSnapshot('1'.repeat(32))?.superseded_by,'3'.repeat(32));
    assert.equal(repo.getSnapshot('2'.repeat(32))?.superseded_by,null);
    const event=repo.getEventsAfter(session.session_id).find(e=>e.event_type==='stored_rekap_ready');
    assert.deepEqual(JSON.parse(event!.payload_json).resolved_review_batch_ids,[old.batch_id]);
    assert.equal(repo.getEventsAfter(session.session_id).some(e=>e.event_type==='storage_result'),false);
    await orchestrator.shutdown();
  }finally{repo.close();}
});
