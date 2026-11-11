import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import {createEvent} from '../src/acp/events.js';
import type {AgentRuntime} from '../src/acp/types.js';

function deferred(){let resolve!:()=>void,reject!:(e:Error)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(){
 const repo=new SigapRepository(),session=repo.createSession('startup');
 const batch=repo.createBatch({sessionId:session.session_id,requestId:'startup',contextId:'startup',sourceSha256:'h',sourceLength:4,filteredText:'Halo',piiSummary:{}});
 const init=deferred(),initStarted=deferred(),progress=deferred();let sends=0;
 const runtime:AgentRuntime={provider:'gemini',isAvailable:async()=>true,closeSession:async()=>{},
  initSession:async()=>{initStarted.resolve();await init.promise;return session.session_id;},
  sendPrompt:async(options,onEvent)=>{sends++;const meta={batchId:batch.batch_id,requestId:'startup'};
   await onEvent(createEvent(session.session_id,'processing_started',{},meta));
   await onEvent(createEvent(session.session_id,'assistant_message',{text:'Siap.'},meta));
  }};
 const orchestrator=new BatchOrchestrator(repo,runtime);
 orchestrator.on('event',event=>{if(event.event_type==='processing_started')progress.resolve();});
 const run=()=>orchestrator.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:'startup',contextId:'startup',filteredText:'Halo'});
 return {repo,session,batch,init,initStarted,progress,orchestrator,run,sends:()=>sends};
}
test('durable progress arrives during MCP setup and runtime start is deduplicated',async()=>{
 const f=fixture();try{
  const work=f.run();await f.initStarted.promise;await f.progress.promise;
  assert.equal(f.sends(),0,'No model/tool before initialization and event persistence');
  assert.deepEqual(f.repo.getEventsAfter(f.session.session_id).map(e=>e.event_type),['processing_started']);
  f.init.resolve();await work;
  const events=f.repo.getEventsAfter(f.session.session_id);
  assert.equal(events.filter(e=>e.event_type==='processing_started').length,1);
  assert.equal(events.at(-1)?.event_type,'processing_completed');assert.equal(f.sends(),1);
  assert.equal(f.repo.getBatch(f.batch.batch_id)?.status,'conversation_done');
 }finally{f.init.resolve();f.repo.close();}
});
test('failed setup produces durable failure after initial progress without dispatching a model/tool',async()=>{
 const f=fixture();try{
  const work=f.run();await f.progress.promise;f.init.reject(Error('synthetic setup failure'));await work;
  assert.equal(f.sends(),0);assert.equal(f.repo.getBatch(f.batch.batch_id)?.status,'failed');
  const events=f.repo.getEventsAfter(f.session.session_id);
  assert.equal(events.filter(e=>e.event_type==='processing_started').length,1);
  assert(events.some(e=>e.event_type==='error'));assert.equal(events.at(-1)?.event_type,'processing_completed');
 }finally{f.repo.close();}
});
test('failed initial persistence settles setup and prevents model/tool dispatch',async()=>{
 const f=fixture();try{
  const append=f.repo.appendEvent.bind(f.repo);f.repo.appendEvent=params=>{if(params.eventType==='processing_started')throw Error('synthetic persistence failure');return append(params);};
  let done=false;const work=f.run().then(()=>{done=true;});await f.initStarted.promise;
  assert.equal(done,false,'Failed metadata must not leave setup running after operation cleanup');
  assert.equal(f.sends(),0);f.init.resolve();await work;
  assert.equal(f.sends(),0);assert.equal(f.repo.getBatch(f.batch.batch_id)?.status,'failed');
  assert.equal(f.repo.getEventsAfter(f.session.session_id).at(-1)?.event_type,'processing_completed');
 }finally{f.init.resolve();f.repo.close();}
});
