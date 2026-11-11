import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AuthService,AccessError} from '../src/auth/service.js';
import {SupabaseGateway} from '../src/supabase/client.js';

const membership={user_id:'user',organization_id:'org',role:'petugas',status:'active',scopes:['posko'],display_name:'Petugas'};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
const token='header.'+Buffer.from(JSON.stringify({sub:'user',session_id:'session',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
class Gateway extends SupabaseGateway {
  calls:string[]=[];
  valid=true;
  profile:unknown=membership;
  scopeAllowed=true;
  hold:Promise<void>=Promise.resolve();
  constructor(){super({url:'https://fixture.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'org'});}
  override async auth(){return {id:'user',user_metadata:{display_name:'Petugas'}};}
  override async call<T=any>(action:string):Promise<T>{
    this.calls.push(action);
    if(action==='profile.get')return this.profile as T;
    if(action==='profile.ensure')return membership as T;
    if(action==='session.valid'){await this.hold;return this.valid as T;}
    if(action==='scope.check'){if(!this.scopeAllowed)throw new Error('Scope denied');await this.hold;return membership as T;}
    throw new Error('Unexpected call '+action);
  }
}

test('authentication starts independent live reads together and never rewrites existing profiles',async()=>{
  const gateway=new Gateway(),barrier=deferred();gateway.hold=barrier.promise;
  const pending=new AuthService(gateway).authenticate('Bearer '+token);
  await new Promise<void>(r=>setImmediate(r));
  try{assert.deepEqual(gateway.calls,['session.valid','profile.get']);}finally{barrier.resolve();}
  assert.deepEqual((await pending).membership,membership);
  assert.ok(!gateway.calls.includes('profile.ensure'));
});

test('missing profiles are provisioned only after session verification',async()=>{
  const gateway=new Gateway(),barrier=deferred();gateway.profile=null;gateway.hold=barrier.promise;
  const pending=new AuthService(gateway).authenticate('Bearer '+token);
  await new Promise<void>(r=>setImmediate(r));
  try{assert.ok(!gateway.calls.includes('profile.ensure'));}finally{barrier.resolve();}
  assert.deepEqual((await pending).membership,membership);
  assert.deepEqual(gateway.calls,['session.valid','profile.get','profile.ensure']);
});

test('revoked sessions cannot provision profiles',async()=>{
  const gateway=new Gateway();gateway.profile=null;gateway.valid=false;
  await assert.rejects(new AuthService(gateway).authenticate('Bearer '+token),(e:unknown)=>e instanceof AccessError&&e.code==='SESSION_REVOKED');
  assert.ok(!gateway.calls.includes('profile.ensure'));
});

test('workflow authorization overlaps reads and checks revocation and scope afresh on each call',async()=>{
  const gateway=new Gateway(),auth=new AuthService(gateway),barrier=deferred();gateway.hold=barrier.promise;
  const pending=auth.stillAuthorized('user','session','posko');
  try{assert.deepEqual(gateway.calls,['session.valid','scope.check']);}finally{barrier.resolve();}
  await pending;
  gateway.valid=false;
  await assert.rejects(auth.stillAuthorized('user','session','posko'),(e:unknown)=>e instanceof AccessError&&e.code==='SESSION_REVOKED');
  gateway.valid=true;gateway.scopeAllowed=false;
  await assert.rejects(auth.stillAuthorized('user','session','posko'),/Scope denied/);
  assert.equal(gateway.calls.filter(c=>c==='session.valid').length,3);
  assert.equal(gateway.calls.filter(c=>c==='scope.check').length,3);
});

test('permission failures settle all pending reads before rejecting',async()=>{
  const gateway=new Gateway(),barrier=deferred();gateway.hold=barrier.promise;gateway.scopeAllowed=false;
  let settled=false;
  const pending=new AuthService(gateway).stillAuthorized('user','session','posko').finally(()=>{settled=true;});
  await new Promise<void>(r=>setImmediate(r));
  try{assert.equal(settled,false);}finally{barrier.resolve();}
  await assert.rejects(pending,/Scope denied/);
});

test('profile read errors fail closed without attempting profile creation',async()=>{
  const gateway=new Gateway(),call=gateway.call.bind(gateway);
  gateway.call=async<T>(action:string):Promise<T>=>{if(action==='profile.get')throw new Error('Profile unavailable');return call<T>(action);};
  await assert.rejects(new AuthService(gateway).authenticate('Bearer '+token),/Profile unavailable/);
  assert.ok(!gateway.calls.includes('profile.ensure'));
});
