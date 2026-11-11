import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import Fastify from 'fastify';
import {createEventsRoute} from '../src/routes/events.js';
import type {Repository} from '../src/db/contract.js';
import type {BatchOrchestrator} from '../src/pipeline/orchestrator.js';

function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function fixture(expectedAfter=0){
 const history=deferred<any[]>(),started=deferred<void>(),bus=new EventEmitter();
 const repo={getSession:async()=>({session_id:'mine',context_id:'test'}),getEventsAfter:async(id:string,after:number)=>{assert.equal(id,'mine');assert.equal(after,expectedAfter);started.resolve();return history.promise;}} as unknown as Repository;
 const app=Fastify({forceCloseConnections:true});await app.register(createEventsRoute(repo,bus as BatchOrchestrator));
 const url=await app.listen({port:0,host:'127.0.0.1'});
 return {app,history,started,bus,url};
}
const live=(id:number,session='mine')=>({event_id:id,session_id:session,event_type:'processing_completed',payload:{status:'done'}});
const stored=(id:number)=>({event_id:id,event_type:'stage_changed',payload_json:'{"stage":"processing"}'});
async function untilDisconnected(bus:EventEmitter){for(let i=0;i<100&&bus.listenerCount('event');i++)await new Promise(r=>setTimeout(r,5));assert.equal(bus.listenerCount('event'),0);}

test('recovered cursors replay newer commits once while live completion arrives',{timeout:5000},async()=>{
 const f=await fixture(12),controller=new AbortController();
 try{
  const response=await fetch(f.url+'/api/sessions/mine/events?lastEventId=12',{signal:controller.signal});await f.started.promise;
  f.bus.emit('event',live(13));f.bus.emit('event',live(14));
  f.history.resolve([stored(13)]);
  const reader=response.body!.getReader(),decoder=new TextDecoder();let text='';
  while(!text.includes('id: 14\n')){const part=await reader.read();assert.equal(part.done,false);text+=decoder.decode(part.value);}
  assert.deepEqual([...text.matchAll(/^id: (\d+)/gm)].map(m=>Number(m[1])),[13,14]);
  await reader.cancel();await untilDisconnected(f.bus);
 }finally{controller.abort();f.history.resolve([]);await f.app.close();}
});

test('SSE handoff keeps in-flight completion events, deduplicates replay and isolates sessions',{timeout:5000},async()=>{
 const f=await fixture(),controller=new AbortController();
 try{
  const response=await fetch(f.url+'/api/sessions/mine/events',{signal:controller.signal});await f.started.promise;
  f.bus.emit('event',live(2));f.bus.emit('event',live(3));f.bus.emit('event',live(99,'foreign'));
  f.history.resolve([stored(1),stored(2)]);
  const reader=response.body!.getReader(),decoder=new TextDecoder();let text='';
  while(!text.includes('id: 3\n')){const chunk=await reader.read();assert.equal(chunk.done,false);text+=decoder.decode(chunk.value);}
  assert.deepEqual([...text.matchAll(/^id: (\d+)/gm)].map(m=>Number(m[1])),[1,2,3]);
  assert.match(text,/event: processing_completed/);assert.doesNotMatch(text,/id: 99/);
  f.bus.emit('event',live(4));
  const next=await reader.read();assert.match(decoder.decode(next.value),/id: 4/);
  await reader.cancel();await untilDisconnected(f.bus);
 }finally{controller.abort();f.history.resolve([]);await f.app.close();}
});

test('disconnecting during replay removes subscriptions before the read finishes',{timeout:5000},async()=>{
 const f=await fixture(),controller=new AbortController();
 try{
  await fetch(f.url+'/api/sessions/mine/events',{signal:controller.signal});await f.started.promise;
  assert.equal(f.bus.listenerCount('event'),1);controller.abort();await untilDisconnected(f.bus);
  f.history.resolve([]);await new Promise<void>(r=>setImmediate(r));assert.equal(f.bus.listenerCount('event'),0);
 }finally{controller.abort();f.history.resolve([]);await f.app.close();}
});

test('failed replay terminates the stream and releases its subscription',{timeout:5000},async()=>{
 const f=await fixture();
 try{
  const response=await fetch(f.url+'/api/sessions/mine/events');await f.started.promise;
  f.history.reject(new Error('Read unavailable'));
  await assert.rejects(response.text());assert.equal(f.bus.listenerCount('event'),0);
 }finally{await f.app.close();}
});
