import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildServer} from '../src/server.js';
import {SigapRepository} from '../src/db/repo.js';
import type {AgentRuntime} from '../src/acp/types.js';
const id='1'.repeat(32),sha='a'.repeat(64);
const records=[{batch_id:'old',report_id:'R001',shelter_name:'Posko A',village:'A',total_people:10},{batch_id:'old',report_id:'R002',shelter_name:'Posko B',village:'B',total_people:20}];
const result=(rows:Array<(typeof records)[number]&{update_target?:{batch_id:string;report_id:string}}>=records,ref={snapshot_id:id,snapshot_sha256:sha})=>({...ref,shelters:rows.map(r=>({...r,needs:{air_liter_per_hari:{value:r.total_people*15},kkal_per_hari:{value:r.total_people*2100},jamban_unit:{value:Math.ceil(r.total_people/20)},ruang_hunian_m2:{value:r.total_people*3.5}},gaps:{},priority:'SEDANG'})),totals:{total_people:30}});
const text=(value:unknown)=>({content:[{type:'text',text:JSON.stringify(value)}]});
async function fixture(){
 const calls:string[]=[];let fail=false,hold:Promise<void>|undefined;
 const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>{calls.push('init');return 'runtime';},closeSession:async()=>{},sendPrompt:async()=>assert.fail('Initial overview must never call a model'),
  readStoredRekap:async()=>{calls.push('read');if(hold)await hold;return text({status:'ok',total_shelters:2,snapshot_id:id,snapshot_sha256:sha,records});},
  calculateNeedsForSnapshot:async(_session,ref)=>{calls.push('calculate');assert.deepEqual(Object.keys(ref).sort(),['snapshot_id','snapshot_sha256']);if(fail)throw new Error('synthetic failure');return text(result(ref.snapshot_id===id?records:[{...records[0],total_people:12,update_target:{batch_id:'old',report_id:'R001'}}],ref));}};
 const repo=new SigapRepository(':memory:');
 const config={host:'127.0.0.1',port:0,allowedOrigins:[],bobCommand:'unused',bobArgs:'',bobWorkspace:'output/test',langflowUrl:'http://127.0.0.1:1',snapshotDir:'output/test',maxInputBytes:204800,retentionDays:7,approvalTtlSeconds:3600,dbPath:':memory:',sessionToken:'overview-test'};
 const {app,orchestrator}=await buildServer({repo,runtime,config,sessionConfig:{}});
 const session=repo.createSession('overview'),headers={authorization:'Bearer overview-test'},url=`/api/sessions/${session.session_id}/overview`;
 return {app,repo,runtime,orchestrator,session,headers,url,calls,fail:()=>{fail=true;},hold:(p:Promise<void>)=>{hold=p;}};
}
test('first workspace fetch reads and calculates all records without a chat turn, batch, or approval',async()=>{
 const f=await fixture();try{
  const response=await f.app.inject({method:'GET',url:f.url,headers:f.headers});assert.equal(response.statusCode,200,response.body);
  const data=response.json();assert.equal(data.status,'ready');assert.equal(data.records.length,2);assert.equal(data.calculation.totals.air_liter_per_hari,450);
  assert.deepEqual(f.calls,['init','read','calculate']);assert.equal(f.repo.countBatches(f.session.session_id),0);assert.deepEqual(f.repo.getEventsAfter(f.session.session_id),[]);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal((await f.app.inject({method:'GET',url:f.url})).statusCode,401);
  assert.equal((await f.app.inject({method:'GET',url:'/api/sessions/missing/overview',headers:f.headers})).statusCode,404);
 }finally{await f.app.close();f.repo.close();}
});
test('overview preserves a pending correction alongside other shelters without approving or replacing its source',async()=>{
 const f=await fixture();try{
  const batch=f.repo.createBatch({sessionId:f.session.session_id,requestId:'draft',contextId:'overview',sourceSha256:sha,sourceLength:1,filteredText:'synthetic',piiSummary:{}});
  const draft=[{...records[0],total_people:12,update_target:{batch_id:'old',report_id:'R001'}}];
  f.repo.saveSnapshot({snapshotId:'2'.repeat(32),snapshotSha256:'b'.repeat(64),batchId:batch.batch_id,version:1,qualityStatus:'PARSIAL',payload:{records:draft}});f.repo.updateBatchStatus(batch.batch_id,'ready_for_review');
  const response=await f.app.inject({method:'GET',url:f.url,headers:f.headers});const data=response.json();assert.equal(data.status,'ready');assert.equal(data.calculation.shelters.length,2);assert.equal(data.calculation.totals.air_liter_per_hari,480);
  assert.equal(f.repo.getBatch(batch.batch_id)?.status,'ready_for_review');assert.equal(f.repo.countBatches(f.session.session_id),1);
 }finally{await f.app.close();f.repo.close();}
});
test('failed calculations retain fetched records and simultaneous hydration is not run twice',async()=>{
 const f=await fixture();try{
  f.fail();let release!:()=>void;f.hold(new Promise<void>(r=>{release=r;}));
  const pending=f.app.inject({method:'GET',url:f.url,headers:f.headers});
  for(let i=0;i<100&&!f.calls.includes('read');i++)await new Promise(r=>setTimeout(r,1));
  assert.equal(f.orchestrator.isProcessing(f.session.session_id),false,'background reads must not block a new user report');
  const busy=await f.app.inject({method:'GET',url:f.url,headers:f.headers});assert.equal(busy.json().status,'busy');release();
  const partial=(await pending).json();assert.equal(partial.status,'partial');assert.equal(partial.records.length,2);assert.equal(partial.calculation,null);assert.equal(f.calls.filter(x=>x==='read').length,1);
 }finally{await f.app.close();f.repo.close();}
});

test('overview consumes recovery metadata once without repeating candidate queries',async()=>{
 const f=await fixture();try{
  let reads=0;const original=f.repo.getWorkspaceState.bind(f.repo);
  f.repo.getWorkspaceState=(sessionId:string)=>{reads++;return original(sessionId);};
  const recovery=await f.app.inject({url:`/api/sessions/${f.session.session_id}/recovery`,headers:f.headers});
  assert.equal(recovery.statusCode,200);assert.equal(reads,1);
  assert.equal((await f.app.inject({url:f.url,headers:f.headers})).json().status,'ready');assert.equal(reads,1);
  assert.equal((await f.app.inject({url:f.url,headers:f.headers})).json().status,'ready');assert.equal(reads,2,'explicit refresh must fetch current state');
 }finally{await f.app.close();f.repo.close();}
});

test('recovery reuses only calculation cache matching the exact candidate reference',async()=>{
 const f=await fixture();try{
  const batch=f.repo.createBatch({sessionId:f.session.session_id,requestId:'cached',contextId:'overview',sourceSha256:sha,sourceLength:1,filteredText:'fixture',piiSummary:{}});
  const ref={snapshot_id:'3'.repeat(32),snapshot_sha256:'c'.repeat(64)};
  const draft=[{...records[0],total_people:12,update_target:{batch_id:'old',report_id:'R001'}}];
  f.repo.saveSnapshot({snapshotId:ref.snapshot_id,snapshotSha256:ref.snapshot_sha256,batchId:batch.batch_id,version:1,qualityStatus:'OK',payload:{records:draft}});
  f.repo.updateBatchStatus(batch.batch_id,'ready_for_review',{gap_payload_json:JSON.stringify(result(draft,ref))});
  await f.app.inject({url:`/api/sessions/${f.session.session_id}/recovery`,headers:f.headers});
  const data=(await f.app.inject({url:f.url,headers:f.headers})).json();
  assert.equal(data.status,'ready');assert.equal(data.calculation.totals.air_liter_per_hari,480);
  assert.equal(f.calls.filter(c=>c==='calculate').length,1,'only saved recap needs calculation');
  f.repo.updateBatchStatus(batch.batch_id,'ready_for_review',{gap_payload_json:JSON.stringify(result(draft,{...ref,snapshot_sha256:'d'.repeat(64)}))});
  f.calls.length=0;
  const refreshed=(await f.app.inject({url:f.url,headers:f.headers})).json();
  assert.equal(refreshed.status,'ready');assert.equal(f.calls.filter(c=>c==='calculate').length,2,'mismatched cached result must be recalculated');
 }finally{await f.app.close();f.repo.close();}
});

test('foreground work invalidates recovery handoff before the next overview',async()=>{
 const f=await fixture();try{
  let reads=0;const original=f.repo.getWorkspaceState.bind(f.repo);
  f.repo.getWorkspaceState=(sessionId:string)=>{reads++;return original(sessionId);};
  await f.orchestrator.recoverWorkspaceState(f.session.session_id);
  const batch=f.repo.createBatch({sessionId:f.session.session_id,requestId:'new-message',contextId:'overview',sourceSha256:sha,sourceLength:4,filteredText:'halo',piiSummary:{}});
  f.runtime.sendPrompt=async()=>{};
  await f.orchestrator.processBatchMessage({sessionId:f.session.session_id,batchId:batch.batch_id,requestId:'new-message',contextId:'overview',filteredText:'halo'});
  await f.app.inject({url:f.url,headers:f.headers});assert.equal(reads,2);
 }finally{await f.app.close();f.repo.close();}
});

test('expired recovery handoff is not reused',async t=>{
 const f=await fixture();try{
  let reads=0;const original=f.repo.getWorkspaceState.bind(f.repo);
  f.repo.getWorkspaceState=(sessionId:string)=>{reads++;return original(sessionId);};
  await f.orchestrator.recoverWorkspaceState(f.session.session_id);
  const later=Date.now()+30001;t.mock.method(Date,'now',()=>later);
  assert.equal((await f.app.inject({url:f.url,headers:f.headers})).json().status,'ready');assert.equal(reads,2);
 }finally{await f.app.close();f.repo.close();}
});

test('recovery during active work cannot keep overview busy after the work finishes',async()=>{
 const f=await fixture();try{
  const batch=f.repo.createBatch({sessionId:f.session.session_id,requestId:'active',contextId:'overview',sourceSha256:sha,sourceLength:1,filteredText:'fixture',piiSummary:{}});
  const recovered=await f.orchestrator.recoverWorkspaceState(f.session.session_id);assert.equal(recovered.activeBatch?.batch_id,batch.batch_id);
  f.repo.updateBatchStatus(batch.batch_id,'conversation_done');
  assert.equal((await f.app.inject({url:f.url,headers:f.headers})).json().status,'ready');
 }finally{await f.app.close();f.repo.close();}
});
