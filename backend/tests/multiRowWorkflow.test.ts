import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {AuthService} from '../src/auth/service.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import {createEvent} from '../src/acp/events.js';
import type {AgentRuntime} from '../src/acp/types.js';
import {snapshotHash} from '../src/pipeline/rowDrafts.js';
import {validateAndCreateApproval} from '../src/approvals/gate.js';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function fixture(options:{badCalculation?:number;failDraft?:number}={}){
 const repo=new SigapRepository(),session=repo.createSession('fixture-context');
 const batch=repo.createBatch({sessionId:session.session_id,contextId:session.context_id,requestId:'rows',sourceSha256:'fixture',sourceLength:1,filteredText:'synthetic rows',piiSummary:{}});
 const records=[0,10,null].map((total_people,index)=>({report_id:'R00'+(index+1),shelter_name:'Posko '+index,village:'Desa '+index,total_people,male:null}));
 const children=records.map(record=>({snapshot_kind:'report_candidate',records:[record],report_records:[record],issues:[],snapshot_issues:[]}));
 const refs=children.map((child,index)=>({snapshot_id:String(index+1).repeat(32),snapshot_sha256:snapshotHash(child)}));
 const parent={snapshot_kind:'report_candidate',records,report_records:records,issues:[],row_snapshot_refs:refs};
 const ref={snapshot_id:'a'.repeat(32),snapshot_sha256:snapshotHash(parent)};
 const gateway=new SupabaseGateway({url:'https://fixture.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'fixture-org'});
 gateway.call=async(action,args:any)=>{
  if(action==='session.valid')return true as any;
  if(action==='scope.check')return {} as any;
  assert.equal(action,'flow.load');assert.equal(args.actor_id,'fixture-user');assert.equal(args.context_id,session.context_id);
  const index=refs.findIndex(r=>r.snapshot_id===args.id);
  return {envelope:{created_at:Date.now()/1000,sha256:index<0?ref.snapshot_sha256:refs[index].snapshot_sha256,payload:index<0?parent:children[index]}} as any;
 };
 const releases=records.map(()=>deferred()),both=deferred(),third=deferred();let active=0,max=0,stores=0;
 const original=repo.getOrCreateReviewSnapshot.bind(repo);
 repo.getOrCreateReviewSnapshot=input=>{stores++;if(stores===options.failDraft)throw Error('Injected draft persistence failure');return original(input);};
 const runtime:AgentRuntime={provider:'gemini',isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},
  sendPrompt:async(input,onEvent,gate)=>{
   assert.equal((await gate!(session.session_id,{toolName:'validate_needs',args:{},toolCallId:'validate'})).allow,true);
   await onEvent(createEvent(session.session_id,'preview_ready',{rawOutput:JSON.stringify({...ref,records,issues:[]})},{batchId:batch.batch_id,requestId:batch.request_id}));
  },
  calculateNeedsForSnapshot:async(_session,reference)=>{
   assert.deepEqual(Object.keys(reference).sort(),['snapshot_id','snapshot_sha256']);
   const index=refs.findIndex(r=>r.snapshot_id===reference.snapshot_id);assert.ok(index>=0);assert.equal(reference.snapshot_sha256,refs[index].snapshot_sha256);
   active++;max=Math.max(max,active);if(active===2)both.resolve();if(index===2)third.resolve();
   try{
    await releases[index].promise;const record=records[index],people=record.total_people;
    return {content:[{type:'text',text:JSON.stringify({...reference,snapshot_sha256:index===options.badCalculation?'f'.repeat(64):reference.snapshot_sha256,
     shelters:[{shelter_name:record.shelter_name,village:record.village,total_people:people,priority:'BELUM PASTI',needs:people===null?{}:{air_liter_per_hari:{value:people*15}},gaps:{}}],totals:{total_people:people}})}]};
   }finally{active--;}
  }};
 const engine=new BatchOrchestrator(repo,runtime);engine.auth=new AuthService(gateway);
 engine.setPrincipal(session.session_id,{userId:'fixture-user',sessionId:'fixture-auth',expiresAt:Date.now()+60000,token:'fixture',membership:{user_id:'fixture-user',display_name:'Fixture',organization_id:'fixture-org',status:'active',role:'petugas',scopes:[session.context_id]}});
 const events=()=>repo.getEventsAfter(session.session_id),child=(index:number)=>repo.getBatchByRequestId(`row:${batch.batch_id}:${refs[index].snapshot_id}`,session.session_id)!;
 return {repo,engine,session,batch,records,refs,releases,both,third,events,child,max:()=>max,active:()=>active,
  run:()=>engine.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:session.context_id,filteredText:'synthetic rows'}),
  close:async()=>{releases.forEach(r=>r.resolve());await engine.shutdown();repo.close();}};
}

test('bounded row calculations preserve independent zero/unknown drafts and publish in source order',async()=>{
 const f=fixture();let work:Promise<void>|undefined;try{
  work=f.run();await Promise.race([f.both.promise,work.then(()=>{throw Error('Processing finished before concurrent calculations started');})]);assert.equal(f.max(),2);
  assert.equal(f.events().filter(e=>e.event_type==='approval_required').length,0);
  f.releases[1].resolve();await f.third.promise;f.releases[2].resolve();
  await Promise.resolve();assert.equal(f.events().filter(e=>e.event_type==='calculation_ready').length,0);
  f.releases[0].resolve();await work;
  assert.equal(f.max(),2);assert.equal(f.active(),0);assert.equal(f.repo.getBatch(f.batch.batch_id)!.status,'split_for_review');
  const approvals=f.events().filter(e=>e.event_type==='approval_required');assert.deepEqual(approvals.map(e=>e.batch_id),[0,1,2].map(i=>f.child(i).batch_id));
  for(const [i,record] of f.records.entries()){
   const child=f.child(i),preview=JSON.parse(child.preview_payload_json!),gap=JSON.parse(child.gap_payload_json!);
   assert.equal(child.status,'ready_for_review');assert.equal(preview.records.length,1);assert.equal(preview.records[0].total_people,record.total_people);
   assert.equal(gap.snapshot_id,f.refs[i].snapshot_id);assert.equal(gap.shelters[0].needs.air_liter_per_hari?.value,record.total_people===null?undefined:record.total_people*15);
  }
 }finally{f.releases.forEach(r=>r.resolve());await work;await f.close();}
});

test('foreign calculation reference stays unavailable for its row without hiding other rows',async()=>{
 const f=fixture({badCalculation:1});try{
  f.releases.forEach(r=>r.resolve());await f.run();
  assert.equal(f.child(1).gap_payload_json,null);assert.ok(f.child(0).gap_payload_json);assert.ok(f.child(2).gap_payload_json);
  const failures=f.events().filter(e=>e.event_type==='stage_changed'&&JSON.parse(e.payload_json).stage==='recalculation_failed');
  assert.deepEqual(failures.map(e=>e.batch_id),[f.child(1).batch_id]);assert.equal(f.events().filter(e=>e.event_type==='approval_required').length,3);
 }finally{await f.close();}
});

test('failed row persistence invalidates prepared siblings and never offers a partial import for approval',async()=>{
 const f=fixture({failDraft:2});try{
  await f.run();assert.equal(f.repo.getBatch(f.batch.batch_id)!.status,'payload_invalid');
  assert.equal(f.child(0).status,'payload_invalid');assert.equal(f.child(1).status,'payload_invalid');
  assert.equal(f.repo.getActiveBatch(f.session.session_id),null);assert.equal(f.repo.getReviewSnapshots(f.session.session_id).length,0);
  assert.equal(f.events().filter(e=>e.event_type==='approval_required').length,0);assert.equal(f.max(),0);
  const back=await validateAndCreateApproval(f.repo,f.child(0),'fixture-user',{action:'back_to_review',snapshot_id:f.refs[0].snapshot_id,partial_acknowledged:true,clear_decisions:{}});
  assert.equal(back.valid,false);assert.equal(f.child(0).status,'payload_invalid');assert.equal(f.child(0).latest_snapshot_id,null);
  assert.equal(f.events().filter(e=>e.event_type==='error'&&JSON.parse(e.payload_json).code==='ROW_PREPARATION_FAILED').length,2);
 }finally{await f.close();}
});
