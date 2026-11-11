import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SupabaseGateway} from '../src/supabase/client.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {mapConcurrent,checkedWorkspaceState} from '../src/db/workspace.js';

test('bounded workspace and active reads each use one exact-session request',async()=>{
 const snapshot={snapshot_id:'snapshot',snapshot_sha256:'hash',batch_id:'review',payload_json:'{}',superseded_by:null,expires_at:'2999-01-01'};
 const review={snapshot,batch:{batch_id:'review',session_id:'mine',status:'ready_for_review',gap_payload_json:'gap'}};
 const active={batch_id:'active',session_id:'mine',status:'processing'};
 const calls:any[]=[];
 class Fixture extends SupabaseGateway {
  override async call<T>(action:string,args:any):Promise<T>{
   calls.push({action,args});assert.equal(action,'entity.list');assert.deepEqual(args.filter,{session_id:'mine'});assert.equal(args.workspace_state,true);
   assert.ok(!Number.isNaN(Date.parse(args.workspace_cutoff)));
   return {reviews:args.active_only?[]:[review],activeBatch:active} as T;
  }
 }
 const repo=new SupabaseRepository(new Fixture({url:'https://fixture.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'fixture'}));
 assert.deepEqual((await repo.getWorkspaceState('mine')).reviews,[review]);assert.deepEqual(await repo.getActiveBatch('mine'),active);
 assert.equal(calls.length,2);assert.equal(calls[1].args.active_only,true);
});

test('bounded workspace responses reject foreign, superseded, duplicate or malformed scope',()=>{
 const row={snapshot:{snapshot_id:'snapshot',snapshot_sha256:'hash',batch_id:'batch',payload_json:'{}',expires_at:'2999-01-01',superseded_by:null},batch:{batch_id:'batch',session_id:'mine',status:'ready_for_review'}};
 const state={reviews:[row],activeBatch:null};
 assert.deepEqual(checkedWorkspaceState(state,'mine'),state);
 for(const value of [null,{}, {...state,activeBatch:undefined}, {...state,activeBatch:{batch_id:'x',session_id:'foreign',status:'saving'}},
  {...state,reviews:[row,row]}, {...state,reviews:[{...row,batch:{...row.batch,session_id:'foreign'}}]},
  {...state,reviews:[{...row,snapshot:{...row.snapshot,batch_id:'foreign'}}]},
  {...state,reviews:[{...row,snapshot:{...row.snapshot,superseded_by:'new'}}]},
  {...state,reviews:[{...row,batch:{...row.batch,status:'done'}}]}])
   assert.throws(()=>checkedWorkspaceState(value,'mine'),/Invalid workspace/);
 assert.throws(()=>checkedWorkspaceState(state,'mine',true),/Invalid workspace/);
});

test('workspace reads reuse batch metadata, limit concurrent queries and exclude expired or foreign snapshots',async()=>{
 const batches=Array.from({length:24},(_,index)=>({batch_id:`b${index}`,session_id:'mine',status:'ready_for_review',gap_payload_json:`gap${index}`}));
 let pending=0,peak=0,batchReads=0,snapshotReads=0;
 class Fixture extends SupabaseGateway {
  override async call<T>(action:string,args:any):Promise<T>{
   assert.equal(action,'entity.list');
   if(args.kind==='batches'){assert.equal(args.filter.session_id,'mine');batchReads++;return [...batches,{batch_id:'working',session_id:'mine',status:'saving'}] as T;}
   assert.equal(args.kind,'snapshots');assert.equal(args.filter.superseded_by,null);snapshotReads++;peak=Math.max(peak,++pending);
   await new Promise(r=>setTimeout(r,3));pending--;
   const index=Number(args.filter.batch_id.slice(1));
   return [{snapshot_id:`s${index}`,batch_id:args.filter.batch_id,superseded_by:null,expires_at:index<22?'2000-01-01':'2999-01-01'},
    {snapshot_id:'superseded',batch_id:args.filter.batch_id,superseded_by:'new',expires_at:'2999-01-01'},
    {snapshot_id:'foreign',batch_id:'other-batch',superseded_by:null,expires_at:'2999-01-01'}] as T;
  }
 }
 const gateway=new Fixture({url:'https://example.supabase.co',publishableKey:'fixture',gatewaySecret:'fixture',organizationId:'fixture'});
 const state=await new SupabaseRepository(gateway).getWorkspaceState('mine');
 assert.equal(batchReads,1);assert.equal(snapshotReads,24);assert.equal(peak,6);
 assert.deepEqual(state.reviews.map(r=>r.snapshot.snapshot_id),['s23','s22']);
 assert.deepEqual(state.reviews.map(r=>r.batch.gap_payload_json),['gap23','gap22']);assert.equal(state.activeBatch?.batch_id,'working');
});

test('bounded reads preserve source order and settle outstanding work after failure',async()=>{
 let inFlight=0;
 const success=await mapConcurrent([3,2,1],2,async value=>{await new Promise(r=>setTimeout(r,value));return value*2;});
 assert.deepEqual(success,[6,4,2]);
 await assert.rejects(mapConcurrent([1,2,3,4,5],2,async value=>{
  inFlight++;try{await new Promise(r=>setTimeout(r,value===1?1:8));if(value===1)throw new Error('read failed');return value;}finally{inFlight--;}
 }),/read failed/);
 assert.equal(inFlight,0);
});
