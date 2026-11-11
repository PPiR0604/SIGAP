import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitRowSnapshots,snapshotHash} from '../src/pipeline/rowDrafts.js';
import {SupabaseGateway} from '../src/supabase/client.js';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}

test('scoped child reads overlap at most two, settle failures and preserve source order',async()=>{
 const records=[0,10,null].map((total_people,index)=>({report_id:'R00'+(index+1),shelter_name:'Posko '+index,village:'Desa '+index,total_people}));
 const children=records.map(record=>({records:[record],issues:[]}));
 const refs=children.map((child,index)=>({snapshot_id:String(index+1).repeat(32),snapshot_sha256:snapshotHash(child)}));
 const parent={records,row_snapshot_refs:refs},ref={snapshot_id:'a'.repeat(32),snapshot_sha256:snapshotHash(parent)};
 const gateway=new SupabaseGateway({url:'https://fixture.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'fixture'});
 const releases=records.map(()=>deferred()),both=deferred(),third=deferred();let active=0,max=0,completed=false;
 gateway.call=async(action,args:any)=>{
  assert.equal(action,'flow.load');assert.equal(args.actor_id,'fixture-actor');assert.equal(args.context_id,'fixture-context');
  if(args.id===ref.snapshot_id)return {envelope:{sha256:ref.snapshot_sha256,payload:parent}} as any;
  const index=refs.findIndex(r=>r.snapshot_id===args.id);assert.ok(index>=0);
  active++;max=Math.max(max,active);if(active===2)both.resolve();if(index===2)third.resolve();
  try{await releases[index].promise;return {envelope:{sha256:refs[index].snapshot_sha256,payload:children[index]}} as any;}finally{active--;}
 };
 const work=splitRowSnapshots(gateway,'fixture-actor','fixture-context',ref).finally(()=>{completed=true;});
 try{
  await both.promise;assert.equal(max,2);releases[1].resolve();await third.promise;
  assert.equal(max,2);releases[2].resolve();await Promise.resolve();assert.equal(completed,false);
  releases[0].resolve();const parts=await work;
  assert.deepEqual(parts.map(p=>p.records[0].total_people),[0,10,null]);assert.equal(active,0);
 }finally{releases.forEach(r=>r.resolve());await work;}
});

test('a rejected child cannot return partial rows and waits for its in-flight sibling',async()=>{
 const records=[{report_id:'R001',total_people:10},{report_id:'R002',total_people:20}],refs=records.map((_,i)=>({snapshot_id:String(i+1).repeat(32),snapshot_sha256:'b'.repeat(64)}));
 const parent={records,row_snapshot_refs:refs},ref={snapshot_id:'a'.repeat(32),snapshot_sha256:snapshotHash(parent)};
 const sibling=deferred(),started=deferred(),failed=deferred();let complete=false;
 const gateway=new SupabaseGateway({url:'https://fixture.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'fixture'});
 gateway.call=async(_action,args:any)=>{
  if(args.id===ref.snapshot_id)return {envelope:{sha256:ref.snapshot_sha256,payload:parent}} as any;
  if(args.id===refs[0].snapshot_id){await started.promise;failed.resolve();throw Error('Scope revoked');}
  started.resolve();await sibling.promise;return {envelope:{sha256:refs[1].snapshot_sha256,payload:{records:[records[1]]}}} as any;
 };
 const work=splitRowSnapshots(gateway,'actor','context',ref).finally(()=>{complete=true;}),rejected=assert.rejects(work,/Scope revoked/);
 await failed.promise;await Promise.resolve();assert.equal(complete,false);sibling.resolve();await rejected;
});
