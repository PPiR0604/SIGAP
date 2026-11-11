import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import type {AgentRuntime} from '../src/acp/types.js';

const oldRef={snapshot_id:'1'.repeat(32),snapshot_sha256:'a'.repeat(64)};
const newRef={snapshot_id:'2'.repeat(32),snapshot_sha256:'b'.repeat(64)};
const original=[{report_id:'R001',shelter_name:'Posko A',village:'Desa A',total_people:10,male:4,female:6,urgent_needs:['air']},
  {report_id:'R002',shelter_name:'Posko B',village:'Desa B',total_people:20,male:9,female:11,urgent_needs:['beras']}];
const corrected=[{...original[0],total_people:12,male:5,female:7},original[1]];
const calculation={...newRef,shelters:corrected.map((r,index)=>({...r,priority:'normal',needs:{air_liter_per_hari:{value:[180,300][index]}},gaps:{air_liter_per_hari:null}})),totals:{total_people:32,air_liter_per_hari:480}};

async function runCorrection(mode:'ok'|'unavailable'|'stale'|'omitted'|'invalid'|'altered'|'malformed'='ok',fromStored=false,inline=false){
  const repo=new SigapRepository(':memory:');
  try{
    const session=repo.createSession('test');
    if(!fromStored){
      const previous=repo.createBatch({sessionId:session.session_id,requestId:'original',contextId:'test',sourceSha256:'a'.repeat(64),sourceLength:1,filteredText:'original',piiSummary:{}});
      repo.saveSnapshot({snapshotId:oldRef.snapshot_id,snapshotSha256:oldRef.snapshot_sha256,batchId:previous.batch_id,version:1,qualityStatus:'PARSIAL',payload:{records:original}});
      repo.updateBatchStatus(previous.batch_id,'ready_for_review');
    }
    const text='Koreksi laporan R001 (Posko A): jumlah jiwa: 12. laki-laki: 5. perempuan: 7.';
    const batch=repo.createBatch({sessionId:session.session_id,requestId:'correction',contextId:'test',sourceSha256:'b'.repeat(64),sourceLength:text.length,filteredText:text,piiSummary:{}});
    const calls:any[]=[];
    const output=()=>mode==='stale'?{...calculation,...oldRef}:mode==='omitted'?{...calculation,shelters:calculation.shelters.slice(0,1)}:mode==='altered'?{...calculation,shelters:calculation.shelters.map((r,i)=>i===0?{...r,total_people:999}:r)}:mode==='malformed'?{}:calculation;
    const runtime:AgentRuntime={
      isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
      readStoredRekap:async()=>({content:[{type:'text',text:JSON.stringify({status:'ok',...oldRef,records:original})}]}),
      sendPrompt:async(options,onEvent)=>{
        assert.match(options.prompt,/otomatis menghitung ulang/);
        const emit=(event_type:any,payload:any)=>onEvent({session_id:session.session_id,batch_id:batch.batch_id,event_type,payload,timestamp:new Date().toISOString()});
        emit('preview_ready',{rawOutput:JSON.stringify({...newRef,records:mode==='invalid'?[]:corrected,snapshot_records:mode==='invalid'?[]:corrected,issues:[],...(inline?{validated_calculation:output()}:{})})});
        // An intermediate model calculation must not overwrite the corrected view.
        emit('calculation_ready',{rawOutput:JSON.stringify({...calculation,...oldRef})});
      },
      calculateNeedsForSnapshot:async(id,reference)=>{
        assert.equal(id,session.session_id);calls.push(reference);
        assert.equal(repo.getEventsAfter(session.session_id).some(event=>event.event_type==='approval_required'),false);
        if(mode==='unavailable')throw new Error('Langflow offline');
        const result=output();
        return {content:[{type:'text',text:JSON.stringify(result)}]};
      },
    };
    const orchestrator=new BatchOrchestrator(repo,runtime);
    await orchestrator.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'test',filteredText:text});
    return {calls,batch:repo.getBatch(batch.batch_id)!,events:repo.getEventsAfter(session.session_id).map(e=>({type:e.event_type,payload:JSON.parse(e.payload_json)}))};
  }finally{repo.close();}
}

test('correction automatically calculates the final snapshot before approval, preserving other villages',async()=>{
  for(const fromStored of [false,true]){
    const result=await runCorrection('ok',fromStored);
    assert.deepEqual(result.calls,[newRef]);
    assert.equal(result.batch.status,'ready_for_review');
    const calculations=result.events.filter(e=>e.type==='calculation_ready');
    assert.equal(calculations.length,1);
    assert.equal(calculations[0].payload.automatic_recalculation,true);
    assert.equal(calculations[0].payload.snapshot_id,newRef.snapshot_id);
    assert.equal(calculations[0].payload.shelters[0].needs.air_liter_per_hari.value,180);
    assert.equal(calculations[0].payload.shelters[1].needs.air_liter_per_hari.value,300);
    assert.ok(result.events.findIndex(e=>e.type==='calculation_ready')<result.events.findIndex(e=>e.type==='approval_required'));
    assert.equal(result.events.at(-1)?.type,'processing_completed');
    assert.equal(result.events.some(e=>['storage_result','readback_result'].includes(e.type)),false);
  }
});

for(const mode of ['unavailable','stale','omitted'] as const)test(`recalculation ${mode} keeps the valid correction without publishing stale or partial results`,async()=>{
  const result=await runCorrection(mode);
  assert.equal(result.batch.status,'ready_for_review');
  assert.equal(result.events.some(e=>e.type==='calculation_ready'),false);
  assert.equal(result.events.some(e=>e.type==='stage_changed'&&e.payload.stage==='recalculation_failed'),true);
  assert.equal(result.events.some(e=>e.type==='approval_required'),true);
  assert.equal(result.events.some(e=>e.type==='assistant_message'&&/belum berhasil dihitung ulang/.test(e.payload.text)),true);
});

test('invalid correction never triggers automatic calculation',async()=>{
  const result=await runCorrection('invalid');
  assert.equal(result.batch.status,'payload_invalid');
  assert.equal(result.calls.length,0);
  assert.equal(result.events.some(e=>e.type==='approval_required'),false);
});

test('validated inline calculation removes the extra call and retains the complete current snapshot',async()=>{
 const result=await runCorrection('unavailable',false,true);
 assert.deepEqual(result.calls,[]);
 assert.equal(result.batch.status,'ready_for_review');
 assert.equal(JSON.parse(result.batch.preview_payload_json!).validated_calculation,undefined);
 const preview=JSON.parse(result.batch.preview_payload_json!);
 assert.equal(preview.snapshot_records,undefined);
 assert.equal(preview.records.length,2);
 assert.deepEqual(preview.records.map((r:any)=>r.total_people),[12,20]);
 const published=result.events.find(e=>e.type==='preview_ready')!.payload;
 assert.equal(published.snapshot_records,undefined);
 assert.equal(published.records.length,2);
 assert.equal(JSON.parse(result.batch.gap_payload_json!).shelters[0].needs.air_liter_per_hari.value,180);
 const events=result.events.filter(e=>e.type==='calculation_ready');
 assert.equal(events.length,1);assert.equal(events[0].payload.snapshot_id,newRef.snapshot_id);
 assert.equal(events[0].payload.shelters.length,2);
 assert.equal(events[0].payload.shelters[0].needs.air_liter_per_hari.value,180);
 assert.equal(events[0].payload.shelters[1].needs.air_liter_per_hari.value,300);
 assert.ok(result.events.findIndex(e=>e.type==='calculation_ready')<result.events.findIndex(e=>e.type==='approval_required'));
});

for(const mode of ['stale','omitted','altered','malformed'] as const)test(`inline calculation ${mode} is rejected without publishing or silently replacing it`,async()=>{
 const result=await runCorrection(mode,false,true);
 assert.deepEqual(result.calls,[]);
 assert.equal(result.batch.status,'ready_for_review');
 assert.equal(result.events.some(e=>e.type==='calculation_ready'),false);
 assert.equal(result.events.some(e=>e.type==='stage_changed'&&e.payload.stage==='recalculation_failed'),true);
 assert.equal(result.events.some(e=>e.type==='approval_required'),true);
});

for(const alteredAlias of [false,true])test('legacy preview alias is ignored only when equivalent: '+alteredAlias,async()=>{
 const repo=new SigapRepository(':memory:');const session=repo.createSession('legacy');
 const batch=repo.createBatch({sessionId:session.session_id,requestId:'legacy',contextId:'legacy',sourceSha256:'a',sourceLength:1,filteredText:'synthetic',piiSummary:{}});
 const record=original[0];
 const payload={...newRef,records:[record],snapshot_records:[record],issues:[],snapshot_issues:[]};
 repo.saveSnapshot({snapshotId:newRef.snapshot_id,snapshotSha256:newRef.snapshot_sha256,batchId:batch.batch_id,version:1,qualityStatus:'PARSIAL',payload:{...payload,snapshot_records:alteredAlias?[{...record,total_people:999}]:[record]}});
 const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},sendPrompt:async(_options,onEvent)=>{
  await onEvent({session_id:session.session_id,batch_id:batch.batch_id,event_type:'preview_ready',payload:{rawOutput:JSON.stringify(payload)},timestamp:new Date().toISOString()});
 }};
 const engine=new BatchOrchestrator(repo,runtime);
 try{
  await engine.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'legacy',filteredText:'Laporan sintetis.'});
  const result=repo.getBatch(batch.batch_id)!;
  assert.equal(result.status,alteredAlias?'payload_invalid':'ready_for_review');
  if(!alteredAlias){const preview=JSON.parse(result.preview_payload_json!);assert.equal(preview.snapshot_records,undefined);assert.deepEqual(preview.records,[record]);}
  else assert.equal(repo.getEventsAfter(session.session_id).some(e=>e.event_type==='approval_required'),false);
 }finally{await engine.shutdown();repo.close();}
});
