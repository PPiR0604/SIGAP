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

async function runCorrection(mode:'ok'|'unavailable'|'stale'|'omitted'|'invalid'='ok',fromStored=false){
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
    const runtime:AgentRuntime={
      isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
      readStoredRekap:async()=>({content:[{type:'text',text:JSON.stringify({status:'ok',...oldRef,records:original})}]}),
      sendPrompt:async(options,onEvent)=>{
        assert.match(options.prompt,/otomatis menghitung ulang/);
        const emit=(event_type:any,payload:any)=>onEvent({session_id:session.session_id,batch_id:batch.batch_id,event_type,payload,timestamp:new Date().toISOString()});
        emit('preview_ready',{rawOutput:JSON.stringify({...newRef,records:mode==='invalid'?[]:corrected,issues:[]})});
        // An intermediate model calculation must not overwrite the corrected view.
        emit('calculation_ready',{rawOutput:JSON.stringify({...calculation,...oldRef})});
      },
      calculateNeedsForSnapshot:async(id,reference)=>{
        assert.equal(id,session.session_id);calls.push(reference);
        assert.equal(repo.getEventsAfter(session.session_id).some(event=>event.event_type==='approval_required'),false);
        if(mode==='unavailable')throw new Error('Langflow offline');
        const result=mode==='stale'?{...calculation,...oldRef}:mode==='omitted'?{...calculation,shelters:calculation.shelters.slice(0,1)}:calculation;
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
