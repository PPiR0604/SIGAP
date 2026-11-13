import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import {renderWaterRanking,renderPriorityRanking,renderAllNeeds,calculateAllNeeds} from '../src/pipeline/needsScope.js';
import {createEvent} from '../src/acp/events.js';
import type {AgentRuntime} from '../src/acp/types.js';

const storedId='1'.repeat(32),draftId='2'.repeat(32),storedHash='a'.repeat(64),draftHash='b'.repeat(64);
const stored=[{batch_id:'old',report_id:'R001',shelter_name:'Posko A',village:'Desa A',total_people:10,urgent_needs:['air']},
  {batch_id:'old',report_id:'R002',shelter_name:'Posko B',village:'Desa B',total_people:20,urgent_needs:['beras']}];
const draft=[{...stored[0],batch_id:'new',total_people:12,update_target:{batch_id:'old',report_id:'R001'}}];

test('all-needs answer includes verified population and water totals without another model calculation',async()=>{
 const records=[52,32,48].map((total_people,i)=>({shelter_name:'Posko '+i,village:'Desa '+i,total_people}));
 const scope={snapshot_id:storedId,snapshot_sha256:storedHash,records,kind:'stored' as const};
 const result=await calculateAllNeeds([scope],async ref=>JSON.stringify(calculation(records,ref)));
 const text=renderAllNeeds(result);
 assert.match(text,/Jumlah jiwa terdata: \*\*132\*\*/);
 assert.match(text,/Kebutuhan air: \*\*1\.980 L\/24 jam\*\*/);
 assert.doesNotMatch(text,/Total masih parsial/);
 assert.match(renderAllNeeds({...result,partial:true}),/Total masih parsial/);
});

test('an earlier candidate cannot replace newer stored counts and needs no redundant calculation',async()=>{
 const records=[{...stored[0],shelter_id:'a',total_people:48,reported_at:'2026-11-10 08:35'},stored[1]];
 const old=[{...records[0],total_people:46,reported_at:'2026-11-10T08:30'}];
 const scopes=[{snapshot_id:storedId,snapshot_sha256:storedHash,records,kind:'stored' as const},
   {snapshot_id:draftId,snapshot_sha256:draftHash,records:old,kind:'candidate' as const}];
 const calls:string[]=[];
 const result=await calculateAllNeeds(scopes,async ref=>{calls.push(ref.snapshot_id);return JSON.stringify(calculation(ref.snapshot_id===storedId?records:old,ref));});
 assert.deepEqual(calls,[storedId]);
 assert.equal(result.totals.total_people,68);
 assert.equal(result.pending_candidates,false);
 assert.equal(result.snapshot_refs.length,1);
});

function calculation(records:any[],ref:{snapshot_id:string;snapshot_sha256:string}){
  return {...ref,shelters:records.map(r=>({...r,priority:'SEDANG',needs:{air_liter_per_hari:{value:r.total_people*15},kkal_per_hari:{value:r.total_people*2100},jamban_unit:{value:Math.ceil(r.total_people/20)},ruang_hunian_m2:{value:r.total_people*3.5}},gaps:{}})),totals:{total_people:records.reduce((n,r)=>n+r.total_people,0)}};
}

test('model-selected analysis merges stored villages with the pending correction and checks the permission gate',async()=>{
  const repo=new SigapRepository(':memory:');const session=repo.createSession('scope');
  const seed=repo.createBatch({sessionId:session.session_id,requestId:'seed',contextId:'scope',sourceSha256:storedHash,sourceLength:1,filteredText:'synthetic',piiSummary:{}});
  repo.saveSnapshot({snapshotId:draftId,snapshotSha256:draftHash,batchId:seed.batch_id,version:1,qualityStatus:'PARSIAL',payload:{records:draft}});
  repo.updateBatchStatus(seed.batch_id,'ready_for_review');
  const calls:string[]=[];
  const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
    readStoredRekap:async()=>({content:[{type:'text',text:JSON.stringify({status:'ok',total_shelters:2,snapshot_id:storedId,snapshot_sha256:storedHash,records:stored})}]}),
    calculateNeedsForSnapshot:async(_id,ref)=>{calls.push(ref.snapshot_id);return {content:[{type:'text',text:JSON.stringify(calculation(ref.snapshot_id===storedId?stored:draft,ref))}]};},
    sendPrompt:async(options,onEvent,gate)=>{
      assert.ok(options.analyzeNeeds);
      const request={view:'all_needs' as const,scope:options.filteredText!.includes('tersimpan')?'stored' as const:'including_candidates' as const};
      assert.equal((await gate!(session.session_id,{toolName:'analyze_shelter_needs',args:request,toolCallId:'analysis'})).allow,true);
      onEvent(createEvent(session.session_id,'assistant_message',{text:await options.analyzeNeeds(request)},{batchId:options.batchId,requestId:options.requestId}));
    }};
  const engine=new BatchOrchestrator(repo,runtime);
  try{
    for(const [index,text] of ['Tolong periksa kebutuhan di semua desa.','Tolong periksa kebutuhan di semua desa dari rekap tersimpan.','Posko mana yang paling butuh air?','berikan prioritas posko yang paling butuh bantuan'].entries()){
      const onlyStored=index===1;
      const batch=repo.createBatch({sessionId:session.session_id,requestId:String(index),contextId:'scope',sourceSha256:storedHash,sourceLength:text.length,filteredText:text,piiSummary:{}});
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
    assert.deepEqual(calls,[storedId,draftId,storedId,storedId,draftId,storedId,draftId]);
  }finally{await engine.shutdown();repo.close();}
});

test('imperative priority requests are analysis, not new reports, and use validated general scores',async()=>{
  const ref={snapshot_id:storedId,snapshot_sha256:storedHash};
  const calc=calculation(stored,ref);
  Object.assign(calc.shelters[0],{priority:'TINGGI',score:7,reasons:['Kebutuhan air dilaporkan']});
  Object.assign(calc.shelters[1],{priority:'BELUM PASTI',score:9,reasons:['Data kelompok rentan belum lengkap']});
  const result=await calculateAllNeeds([{...ref,records:stored,kind:'stored'}],async()=>JSON.stringify(calc));
  const answer=renderPriorityRanking(result);
  assert.match(answer,/\| Posko A \| Desa A \| TINGGI \| 7 \| Kebutuhan air dilaporkan/);
  assert.match(answer,/Perlu klarifikasi, tidak dimasukkan ke urutan/);
  assert.match(answer,/Posko B — Desa B \(BELUM PASTI\)/);
  assert.doesNotMatch(answer,/\| Posko B/);
});

test('model-selected analysis of an empty recap returns a clear answer without inventing calculations',async()=>{
  const repo=new SigapRepository(':memory:'),session=repo.createSession('empty');
  const text='Menurutmu bantuan apa yang perlu didahulukan?';
  const batch=repo.createBatch({sessionId:session.session_id,requestId:'empty',contextId:'empty',sourceSha256:storedHash,sourceLength:text.length,filteredText:text,piiSummary:{}});
  const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
    readStoredRekap:async()=>({content:[{type:'text',text:JSON.stringify({status:'source_empty',records:[],total_shelters:0})}]}),
    calculateNeedsForSnapshot:async()=>{assert.fail('An empty source cannot be calculated.');},
    sendPrompt:async(options,onEvent)=>{assert.ok(options.analyzeNeeds);onEvent(createEvent(session.session_id,'assistant_message',{text:await options.analyzeNeeds({view:'priority_ranking',scope:'stored'})},{batchId:batch.batch_id,requestId:'empty'}));}};
  const engine=new BatchOrchestrator(repo,runtime);
  try{
    await engine.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:'empty',contextId:'empty',filteredText:text});
    assert.equal(repo.getBatch(batch.batch_id)!.status,'conversation_done');
    assert.ok(repo.getEventsAfter(session.session_id).some(e=>e.event_type==='assistant_message'&&JSON.parse(e.payload_json).text.includes('Belum ada data posko')));
  }finally{await engine.shutdown();repo.close();}
});

test('water answer ranks numeric gaps, handles ties and unknowns, and never mistakes general priority for water need',async()=>{
  const rows=[
    {shelter_name:'Pelita',village:'Cipandan',total_people:54,gap:810},
    {shelter_name:'Cibening',village:'Cibineng',total_people:100,gap:1000},
    {shelter_name:'Harapan',village:'A',total_people:40,gap:500},
    {shelter_name:'Harapan',village:'B',total_people:98,gap:470},
    {shelter_name:'Nusa',village:'A',total_people:120,gap:null},
    {shelter_name:'Cukup',village:'A',total_people:20,gap:0},
  ];
  const ref={snapshot_id:storedId,snapshot_sha256:storedHash};
  const calc=calculation(rows,ref);
  calc.shelters.forEach((r:any,i)=>{r.priority=i===0?'TINGGI':'RENDAH';r.gaps=rows[i].gap===null?{}:{air_liter_per_hari:rows[i].gap};});
  const result=await calculateAllNeeds([{...ref,records:rows,kind:'stored'}],async()=>JSON.stringify(calc));
  const text=renderWaterRanking(result);
  assert.match(text,/\*\*1\.000 L\/hari\*\*, pada \*\*Cibening/);
  assert.ok(text.indexOf('| Cibening')<text.indexOf('| Pelita'));
  assert.ok(text.indexOf('| Harapan — A')<text.indexOf('| Harapan — B'));
  assert.match(text,/Gap air nol: Cukup/);
  assert.match(text,/Belum dapat dibandingkan:\*\* Nusa/);
  result.shelters[0].gaps.air_liter_per_hari=1000;
  assert.match(renderWaterRanking(result),/pada \*\*Cibening — Cibineng; Pelita — Cipandan\*\*/);
  for(const row of result.shelters)row.gaps={};
  assert.match(renderWaterRanking(result),/Belum bisa menentukan/);
});

test('reports describing all residents and stock remain report inputs',async()=>{
  const reports=[
    'Laporan Posko Mawar: 10 jiwa. Semua berusia dewasa. Stok air 200 liter. Tidak ada kebutuhan mendesak.',
    'Posko Harapan, 30 jiwa. Seluruh pengungsi butuh air bersih.',
    'Laporan 2 posko: Posko A 10 jiwa, Posko B 20 jiwa. Semua butuh pangan.',
  ];
  const repo=new SigapRepository(':memory:');const session=repo.createSession('routing');
  const received:string[]=[];
  const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
    readStoredRekap:async()=>{assert.fail('No analysis call was selected by the model.');},
    calculateNeedsForSnapshot:async()=>{assert.fail('A new report must be validated before calculation.');},
    sendPrompt:async options=>{received.push(options.filteredText!);}};
  const engine=new BatchOrchestrator(repo,runtime);
  try{
    for(const text of reports){
      const batch=repo.createBatch({sessionId:session.session_id,requestId:String(received.length),contextId:'routing',sourceSha256:storedHash,sourceLength:text.length,filteredText:text,piiSummary:{}});
      await engine.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'routing',filteredText:text});
    }
    assert.deepEqual(received,reports);
  }finally{await engine.shutdown();repo.close();}
});

for(const mode of ['valid','stored-only','legacy-draft','stale-draft','stale-reader','missing-row','changed-population','altered-draft'] as const){
  test('all-needs query verifies inline reader and existing draft calculations: '+mode,async()=>{
    const repo=new SigapRepository(':memory:');const session=repo.createSession('inline-scope');
    const seed=repo.createBatch({sessionId:session.session_id,requestId:'seed',contextId:'inline-scope',sourceSha256:draftHash,sourceLength:1,filteredText:'synthetic',piiSummary:{}});
    repo.saveSnapshot({snapshotId:draftId,snapshotSha256:draftHash,batchId:seed.batch_id,version:1,qualityStatus:'PARSIAL',payload:{records:draft}});
    const readerCalculation=calculation(stored,{snapshot_id:storedId,snapshot_sha256:storedHash});
    const draftCalculation=calculation(draft,{snapshot_id:draftId,snapshot_sha256:draftHash});
    if(mode==='stale-reader')readerCalculation.snapshot_sha256='c'.repeat(64);
    if(mode==='missing-row')readerCalculation.shelters.pop();
    if(mode==='changed-population')readerCalculation.shelters[0].total_people=999;
    if(mode==='stale-draft')draftCalculation.snapshot_sha256='c'.repeat(64);
    if(mode==='altered-draft')draftCalculation.shelters[0].total_people=999;
    repo.updateBatchStatus(seed.batch_id,'ready_for_review',{gap_payload_json:mode==='legacy-draft'?'not json':JSON.stringify(draftCalculation)});
    const calls:string[]=[];
    const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
      readStoredRekap:async(_session,_signal,options)=>{
        assert.equal(options?.includeCalculation,true);
        return {content:[{type:'text',text:JSON.stringify({status:'ok',total_shelters:stored.length,snapshot_id:storedId,snapshot_sha256:storedHash,records:stored,validated_calculation:readerCalculation})}]};
      },
      calculateNeedsForSnapshot:async(_session,ref)=>{calls.push(ref.snapshot_id);return {content:[{type:'text',text:JSON.stringify(calculation(draft,ref))}]};},
      sendPrompt:async(options,onEvent)=>{assert.ok(options.analyzeNeeds);onEvent(createEvent(session.session_id,'assistant_message',{text:await options.analyzeNeeds({view:'all_needs',scope:mode==='stored-only'?'stored':'including_candidates'})},{batchId:options.batchId,requestId:options.requestId}));}};
    const engine=new BatchOrchestrator(repo,runtime);
    const text='Periksa kebutuhan di semua desa'+(mode==='stored-only'?' dari rekap tersimpan.':'.');
    const batch=repo.createBatch({sessionId:session.session_id,requestId:'query',contextId:'inline-scope',sourceSha256:storedHash,sourceLength:text.length,filteredText:text,piiSummary:{}});
    try{
      await engine.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'inline-scope',filteredText:text});
      const failed=['stale-reader','missing-row','changed-population','altered-draft'].includes(mode);
      const result=repo.getBatch(batch.batch_id)!;
      assert.equal(result.status,failed?'failed':'conversation_done');
      assert.deepEqual(calls,['legacy-draft','stale-draft'].includes(mode)?[draftId]:[]);
      if(failed){
        assert.equal(result.gap_payload_json,null);
        assert.equal(repo.getEventsAfter(session.session_id).filter(e=>e.batch_id===batch.batch_id&&e.event_type==='calculation_ready').length,0);
      }else{
        const gap=JSON.parse(result.gap_payload_json!);
        assert.equal(gap.totals.total_people,mode==='stored-only'?30:32);
        assert.equal(gap.shelters.length,2);
      }
      assert.equal(repo.getBatch(seed.batch_id)!.status,'ready_for_review');
    }finally{await engine.shutdown();repo.close();}
  });
}
