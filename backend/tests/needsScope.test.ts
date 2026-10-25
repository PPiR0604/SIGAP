import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import {isAllNeedsRequest,storedNeedsOnly} from '../src/pipeline/needsScope.js';
import type {AgentRuntime} from '../src/acp/types.js';

const storedId='1'.repeat(32),draftId='2'.repeat(32),storedHash='a'.repeat(64),draftHash='b'.repeat(64);
const stored=[{batch_id:'old',report_id:'R001',shelter_name:'Posko A',village:'Desa A',total_people:10,urgent_needs:['air']},
  {batch_id:'old',report_id:'R002',shelter_name:'Posko B',village:'Desa B',total_people:20,urgent_needs:['beras']}];
const draft=[{...stored[0],batch_id:'new',total_people:12,update_target:{batch_id:'old',report_id:'R001'}}];

function calculation(records:any[],ref:{snapshot_id:string;snapshot_sha256:string}){
  return {...ref,shelters:records.map(r=>({...r,priority:'SEDANG',needs:{air_liter_per_hari:{value:r.total_people*15},kkal_per_hari:{value:r.total_people*2100},jamban_unit:{value:Math.ceil(r.total_people/20)},ruang_hunian_m2:{value:r.total_people*3.5}},gaps:{}})),totals:{total_people:records.reduce((n,r)=>n+r.total_people,0)}};
}

test('explicit all-village needs query merges stored villages with the pending correction, without a model selecting a narrower scope',async()=>{
  const repo=new SigapRepository(':memory:');const session=repo.createSession('scope');
  const seed=repo.createBatch({sessionId:session.session_id,requestId:'seed',contextId:'scope',sourceSha256:storedHash,sourceLength:1,filteredText:'synthetic',piiSummary:{}});
  repo.saveSnapshot({snapshotId:draftId,snapshotSha256:draftHash,batchId:seed.batch_id,version:1,qualityStatus:'PARSIAL',payload:{records:draft}});
  repo.updateBatchStatus(seed.batch_id,'ready_for_review');
  const calls:string[]=[];
  const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
    readStoredRekap:async()=>({content:[{type:'text',text:JSON.stringify({status:'ok',total_shelters:2,snapshot_id:storedId,snapshot_sha256:storedHash,records:stored})}]}),
    calculateNeedsForSnapshot:async(_id,ref)=>{calls.push(ref.snapshot_id);return {content:[{type:'text',text:JSON.stringify(calculation(ref.snapshot_id===storedId?stored:draft,ref))}]};},
    sendPrompt:async()=>{assert.fail('A model must not reduce an explicit all-village query to the last correction');}};
  const engine=new BatchOrchestrator(repo,runtime);
  try{
    for(const onlyStored of [false,true]){
      const text='Tolong periksa kebutuhan di semua desa'+(onlyStored?' dari rekap tersimpan.':'.');
      const batch=repo.createBatch({sessionId:session.session_id,requestId:String(onlyStored),contextId:'scope',sourceSha256:storedHash,sourceLength:text.length,filteredText:text,piiSummary:{}});
      await engine.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'scope',filteredText:text});
      assert.equal(repo.getBatch(batch.batch_id)!.status,'conversation_done');
      const gap=JSON.parse(repo.getBatch(batch.batch_id)!.gap_payload_json!);
      assert.equal(gap.shelters.length,2);
      assert.equal(gap.shelters.find((r:any)=>r.village==='Desa B').needs.air_liter_per_hari.value,300);
      assert.equal(gap.shelters.find((r:any)=>r.village==='Desa A').needs.air_liter_per_hari.value,onlyStored?150:180);
      assert.equal(gap.totals.total_people,onlyStored?30:32);
      const answers=repo.getEventsAfter(session.session_id).filter(e=>e.batch_id===batch.batch_id&&e.event_type==='assistant_message');
      assert.ok(answers.some(e=>JSON.parse(e.payload_json).text.includes('Desa B')));
    }
    assert.deepEqual(calls,[storedId,draftId,storedId]);
  }finally{await engine.shutdown();repo.close();}
});

test('all-needs detection respects candidate-specific questions, negatives and bulletin requests',()=>{
  assert.equal(isAllNeedsRequest('Cek kebutuhan semua desa.'),true);
  assert.equal(isAllNeedsRequest('Tolong periksa kebutuhan di seluruh posko.'),true);
  assert.equal(isAllNeedsRequest('Hitung kebutuhan kandidat Posko A saja.'),false);
  assert.equal(isAllNeedsRequest('Kenapa semua desa butuh air?'),false);
  assert.equal(isAllNeedsRequest('Jangan hitung kebutuhan semua desa.'),false);
  assert.equal(isAllNeedsRequest('Buat buletin kebutuhan semua desa.'),false);
  assert.equal(storedNeedsOnly('Periksa kebutuhan semua desa dari rekap tersimpan.'),true);
  assert.equal(storedNeedsOnly('Periksa kebutuhan semua desa termasuk kandidat yang belum tersimpan.'),false);
});
