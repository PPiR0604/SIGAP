// Scoped immutable synthetic metadata only. No model, MCP, approval or shelter save.
import '../src/config.js';
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {AuthService} from '../src/auth/service.js';
import {splitRowSnapshots,snapshotHash} from '../src/pipeline/rowDrafts.js';
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const [userId,authSessionId,contextId]=process.argv.slice(2);
if(!/^[a-f0-9-]{36}$/i.test(userId||'')||!/^[a-f0-9-]{36}$/i.test(authSessionId||'')||!contextId)throw Error('Existing active identity required.');
const settings=loadConfig().supabase;if(!settings)throw Error('Supabase required.');
const gateway=new SupabaseGateway(settings),auth=new AuthService(gateway),args={actor_id:userId,context_id:contextId};
await auth.stillAuthorized(userId,authSessionId,contextId);
const records=[0,10,null,12].map((total_people,index)=>({report_id:'R00'+(index+1),shelter_name:'Synthetic row read '+index,village:'Synthetic fixture',total_people}));
const refs=[];
async function save(payload:any){
 const ref={snapshot_id:randomBytes(16).toString('hex'),snapshot_sha256:snapshotHash(payload)};
 assert.equal(await gateway.call('flow.save',{...args,id:ref.snapshot_id,envelope:{created_at:Date.now()/1000,sha256:ref.snapshot_sha256,payload}}),true);return ref;
}
for(const record of records)refs.push(await save({snapshot_kind:'report_candidate',records:[record],issues:[],snapshot_issues:[]}));
const reference=await save({snapshot_kind:'report_candidate',records,row_snapshot_refs:refs});
const original=gateway.call.bind(gateway);let calls=0,active=0,max=0;
gateway.call=async<T>(action:string,input:Record<string,unknown>={})=>{
 if(action!=='flow.load')return original<T>(action,input);
 calls++;active++;max=Math.max(max,active);
 try{return await original<T>(action,input);}finally{active--;}
};
async function sequential(){
 const parent=await gateway.call('flow.load',{...args,id:reference.snapshot_id});assert.equal(parent.envelope.sha256,reference.snapshot_sha256);assert.ok(!parent.committed_reference);
 const result=[];
 for(const [index,ref] of parent.envelope.payload.row_snapshot_refs.entries()){
  const child=await gateway.call('flow.load',{...args,id:ref.snapshot_id});assert.equal(child.envelope.sha256,ref.snapshot_sha256);assert.ok(!child.committed_reference);
  assert.deepEqual(child.envelope.payload.records,[records[index]]);
  result.push({...ref,records:child.envelope.payload.records,snapshot_records:child.envelope.payload.records,issues:child.envelope.payload.issues,snapshot_issues:child.envelope.payload.snapshot_issues});
 }
 return result;
}
const samples=[];
for(const mode of ['sequential','bounded','bounded','sequential']){
 await auth.stillAuthorized(userId,authSessionId,contextId);calls=0;max=0;
 const started=performance.now(),parts=mode==='bounded'?await splitRowSnapshots(gateway,userId,contextId,reference):await sequential();
 const ms=Math.round(performance.now()-started);assert.equal(parts.length,4);assert.equal(calls,5);assert.ok(max<=(mode==='bounded'?2:1));
 assert.deepEqual(parts.map(part=>part.records[0].total_people),[0,10,null,12]);
 samples.push({mode,ms,flow_load_calls:calls,max_concurrent_reads:max});
}
const result={synthetic:true,source_metadata_only:true,operational_write:false,model_calls:0,mcp_calls:0,synthetic_source_snapshots_created:5,samples};
writeFileSync('../ref/multi-row-read-latency.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
