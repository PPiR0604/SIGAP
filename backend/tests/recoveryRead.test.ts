import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {EventEmitter} from 'node:events';
import {SigapRepository} from '../src/db/repo.js';
import {readAuthenticatedRecovery} from '../src/db/recovery.js';
import {createRecoveryRoute} from '../src/routes/recovery.js';
import {createEventsRoute} from '../src/routes/events.js';
import type {AuthService} from '../src/auth/service.js';
import type {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import type {SupabaseGateway} from '../src/supabase/client.js';

const empty=()=>({header:[],rows:[]});
function gateway(read:(args:any)=>unknown):Pick<SupabaseGateway,'call'>{
 return {call:async<T>(action:string,args:any)=>{assert.equal(action,'storage.read');return await read(args) as T;}};
}

test('combined recovery needs one read, with no second state or cursor query',async()=>{
 const repo=new SigapRepository();try{
  const session=repo.createSession();let calls=0;
  repo.getWorkspaceState=()=>assert.fail('Duplicate state read');repo.getLatestEventId=()=>assert.fail('Duplicate cursor read');
  const data=await readAuthenticatedRecovery(repo,gateway(args=>{
   calls++;assert.equal(args.actor_id,'actor');assert.equal(args.context_id,session.context_id);
   assert.equal(args.recovery_session_id,session.session_id);assert.match(args.workspace_cutoff,/^\d{4}-.*Z$/);
   return {revision:2,document:empty(),recovery:{session_id:session.session_id,after_event_id:7,state:{reviews:[],activeBatch:null}}};
  }),session.session_id,'actor',session.context_id);
  assert.equal(calls,1);assert.deepEqual(data,{state:{reviews:[],activeBatch:null},afterEventId:7,stored:{revision:2,document:empty()}});
 }finally{repo.close();}
});

test('legacy fallback discards early storage and replays commits after its new cursor',async()=>{
 const repo=new SigapRepository();try{
  const session=repo.createSession();let revision=0,reads=0;
  const oldState=repo.getWorkspaceState.bind(repo);
  repo.getWorkspaceState=id=>{
   revision=1;repo.appendEvent({sessionId:id,eventType:'readback_result',payload:{records:[{total_people:10}]}});
   return oldState(id);
  };
  const data=await readAuthenticatedRecovery(repo,gateway(()=>({revision:revision,document:{header:['jumlah_jiwa'],rows:[[String(reads++?revision:0)]]}})),session.session_id,'actor',session.context_id);
  assert.equal(reads,2);assert.equal(data.afterEventId,0);assert.deepEqual(data.stored.document.rows,[['1']]);
  assert.equal(repo.getEventsAfter(session.session_id,data.afterEventId).length,1,'Concurrent commit must remain replayable');
 }finally{repo.close();}
});

test('invalid combined state and denied reads fail closed without fallback',async()=>{
 const repo=new SigapRepository();try{
  const session=repo.createSession(),valid={revision:0,document:empty(),recovery:{session_id:session.session_id,after_event_id:0,state:{reviews:[],activeBatch:null}}};
  repo.getWorkspaceState=()=>assert.fail('Invalid data must not trigger fallback');repo.getLatestEventId=()=>assert.fail('Invalid data must not trigger fallback');
  for(const bad of [null,{}, {...valid,recovery:null},{...valid,revision:-1},
   ...[-1,1.2,'3',Number.MAX_SAFE_INTEGER+1].map(after_event_id=>({...valid,recovery:{...valid.recovery,after_event_id}})),
   {...valid,recovery:{...valid.recovery,session_id:'other'}},
   {...valid,recovery:{...valid.recovery,state:{reviews:[],activeBatch:{session_id:'other',batch_id:'x',status:'saving'}}}}]){
   await assert.rejects(readAuthenticatedRecovery(repo,gateway(()=>bad),session.session_id,'actor',session.context_id),/Invalid/);
  }
  await assert.rejects(readAuthenticatedRecovery(repo,gateway(()=>{throw Error('denied');}),session.session_id,'actor',session.context_id),/denied/);
 }finally{repo.close();}
});

test('recovery and event replay retain a commit arriving before hydration finishes',async()=>{
 const repo=new SigapRepository(),app=Fastify();
 try{
  const session=repo.createSession();let calls=0;
  const auth={gateway:gateway(()=>{
   calls++;const response={revision:0,document:empty(),recovery:{session_id:session.session_id,after_event_id:repo.getLatestEventId(session.session_id),state:repo.getWorkspaceState(session.session_id)}};
   repo.appendEvent({sessionId:session.session_id,eventType:'readback_result',payload:{records:[{total_people:12}]}});
   return response;
  })} as AuthService;
  app.addHook('onRequest',async req=>{req.principal={userId:'actor'} as any;});
  await app.register(createRecoveryRoute(repo,auth));
  await app.register(createEventsRoute(repo,new EventEmitter() as BatchOrchestrator));
  const response=await app.inject({url:`/api/sessions/${session.session_id}/recovery`});
  assert.equal(response.statusCode,200,response.body);const data=response.json();
  assert.deepEqual(data.records,[]);assert.equal(data.after_event_id,0);assert.equal(calls,1);
  const events=await app.inject({url:`/api/sessions/${session.session_id}/events?lastEventId=${data.after_event_id}&stream=false`});
  assert.equal(events.statusCode,200);assert.match(events.body,/event: readback_result/);assert.match(events.body,/"total_people":12/);
 }finally{await app.close();repo.close();}
});
