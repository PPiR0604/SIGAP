import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {SigapRepository} from '../src/db/repo.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {createRecoveryRoute} from '../src/routes/recovery.js';
import type {AuthService} from '../src/auth/service.js';
import type {Repository} from '../src/db/contract.js';

test('local event cursor is session-bound and empty sessions start at zero',()=>{
 const repo=new SigapRepository();try{
  const first=repo.createSession(),second=repo.createSession();
  assert.equal(repo.getLatestEventId(first.session_id),0);
  const one=repo.appendEvent({sessionId:first.session_id,eventType:'stage_changed',payload:{}});
  repo.appendEvent({sessionId:second.session_id,eventType:'stage_changed',payload:{}});
  assert.equal(repo.getLatestEventId(first.session_id),one.event_id);
  assert.deepEqual(repo.getEventsAfter(first.session_id,one.event_id),[]);
 }finally{repo.close();}
});

test('cloud cursor is scalar, legacy-compatible and rejects malformed values',async()=>{
 let response:any=23;
 class Gateway extends SupabaseGateway{override async call<T>(action:string,args:any):Promise<T>{
  assert.equal(action,'entity.list');assert.deepEqual(args,{kind:'events',filter:{session_id:'mine'},latest_event_id:true});return response as T;
 }}
 const repo=new SupabaseRepository(new Gateway({url:'https://example.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'fixture'}));
 assert.equal(await repo.getLatestEventId('mine'),23);
 response=[{session_id:'mine',event_id:2},{session_id:'other',event_id:99},{session_id:'mine',event_id:7}];
 assert.equal(await repo.getLatestEventId('mine'),7);
 response=[];assert.equal(await repo.getLatestEventId('mine'),0);
 for(const bad of [null,-1,2.5,'7',Number.MAX_SAFE_INTEGER+1]){response=bad;await assert.rejects(repo.getLatestEventId('mine'),/Invalid event cursor/);}
});

test('cloud replay sends the cursor to the database and defensively checks old gateways',async()=>{
 class Gateway extends SupabaseGateway{override async call<T>(action:string,args:any):Promise<T>{
  assert.equal(action,'entity.list');assert.deepEqual(args,{kind:'events',filter:{session_id:'mine'},after_event_id:4});
  return [{session_id:'mine',event_id:8},{session_id:'other',event_id:9},{session_id:'mine',event_id:3},{session_id:'mine',event_id:5}] as T;
 }}
 const repo=new SupabaseRepository(new Gateway({url:'https://example.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'fixture'}));
 assert.deepEqual((await repo.getEventsAfter('mine',4)).map(e=>e.event_id),[5,8]);
});

test('authenticated recovery captures the cursor before state without loading historical payloads',async()=>{
 const calls:string[]=[];let cursor=12;
 const repo={getSession:()=>({context_id:'ctx'}),getLatestEventId:()=>{calls.push('cursor');return cursor;},
  getEventsAfter:()=>assert.fail('Authenticated recovery must not load history'),
  getWorkspaceState:()=>{calls.push('state');cursor=13;return {reviews:[],activeBatch:null};},
 } as unknown as Repository;
 const auth={gateway:{call:async(action:string)=>{assert.equal(action,'storage.read');calls.push('storage');return {document:{header:[],rows:[]}};}}} as AuthService;
 const app=Fastify();app.addHook('onRequest',async request=>{request.principal={userId:'actor'} as any;});
 await app.register(createRecoveryRoute(repo,auth));
 try{const response=await app.inject({url:'/api/sessions/mine/recovery'});assert.equal(response.statusCode,200);assert.equal(response.json().after_event_id,12);assert.equal(cursor,13);assert.deepEqual(calls,['storage','cursor','state','storage']);}
 finally{await app.close();}
});
