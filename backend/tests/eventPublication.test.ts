import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import type {Repository} from '../src/db/contract.js';
import type {AgentRuntime,ApplicationEvent} from '../src/acp/types.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import {createEvent} from '../src/acp/events.js';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>'',closeSession:async()=>{},sendPrompt:async()=>{}};

test('event writes are ordered within a session while another session remains independent',async()=>{
 const db=new SigapRepository(),release=deferred(),started=deferred(),calls:string[]=[];let seq=0;
 const repo=new Proxy(db,{get(target,key){
  if(key==='appendEvent')return async(input:any)=>{
   const tag=input.payload.text;calls.push(tag);if(tag==='first'){started.resolve();await release.promise;}
   return {event_id:++seq};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }}) as Repository;
 const engine=new BatchOrchestrator(repo,runtime),events:ApplicationEvent[]=[];engine.on('event',event=>events.push(event));
 const publish=(session:string,text:string)=>(engine as any).publish(createEvent(session,'assistant_message',{text})) as Promise<void>;
 let one:Promise<void>|undefined,two:Promise<void>|undefined;
 try{
  one=publish('same','first');await started.promise;two=publish('same','second');await publish('other','independent');
  assert.deepEqual(calls,['first','independent']);assert.deepEqual(events.map(e=>e.payload.text),['independent']);
  release.resolve();await Promise.all([one,two]);
  const same=events.filter(e=>e.session_id==='same');assert.deepEqual(same.map(e=>e.payload.text),['first','second']);
  assert.ok(same[1].event_id!>same[0].event_id!);assert.equal((engine as any).eventWrites.size,0);
 }finally{release.resolve();await Promise.allSettled([one,two]);await engine.shutdown();db.close();}
});

test('failed persistence emits nothing and cannot block later durable error/completion events',async()=>{
 const db=new SigapRepository();let count=0;
 const repo=new Proxy(db,{get(target,key){
  if(key==='appendEvent')return async()=>{if(++count===1)throw Error('Persistence unavailable');return {event_id:count};};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }}) as Repository;
 const engine=new BatchOrchestrator(repo,runtime),events:ApplicationEvent[]=[];engine.on('event',event=>events.push(event));
 try{
  const first=(engine as any).publish(createEvent('same','stage_changed',{stage:'first'})) as Promise<void>;
  const error=(engine as any).publish(createEvent('same','error',{code:'FAILED'})) as Promise<void>;
  await assert.rejects(first,/Persistence unavailable/);await error;
  assert.deepEqual(events.map(e=>e.event_type),['error']);assert.equal((engine as any).eventWrites.size,0);
 }finally{await engine.shutdown();db.close();}
});
