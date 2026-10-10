// All inputs are repository demo fixtures. No operational database is read.
// Real model/MCP run, in-memory backend, read-storage/write/docs tools denied.
import {readFileSync,writeFileSync} from 'node:fs';
import {sampleReport,shelters} from '../../frontend/src/demo.js';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {loadGeminiSettings} from '../src/gemini/config.js';
import {loadAgentSessionConfig} from '../src/acp/sessionConfig.js';
import {canonicalToolName} from '../src/acp/toolNames.js';
import {parsePrepareNeedsOutput} from '../src/pipeline/toolResults.js';
import type {AgentRuntime} from '../src/acp/types.js';
const config=JSON.parse(readFileSync('data/langflow-mcp.local.json','utf8')).mcpServers.langflow;
async function run(id:string,input:string){
  const r=await fetch('http://127.0.0.1:7860/api/v1/run/'+id,{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify({input_value:input,input_type:'chat',output_type:'chat'})});
  if(!r.ok)throw new Error('Synthetic seed flow failed');return r.json();
}
function strings(value:any):string[]{return typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(strings):[];}
const prepared=await run('651a60c0-d1f4-4d8e-9945-ba0af509ffd0',sampleReport);
const source=JSON.parse(strings(prepared).map(t=>/<<<SOURCE_REF>>>(.*?)<<<END_SOURCE_REF>>>/s.exec(t)?.[1]).find(Boolean)!);
const records=shelters.map(row=>({report_id:row.id,shelter_name:row.name,total_people:row.people,male:row.male,female:row.female,elderly:row.elderly,disability:row.disability,is_estimate:row.estimate||false,urgent_needs:row.needs}));
const result=await run('7549a8d3-b694-44f9-91f2-149fb7a88d4f',JSON.stringify({...source,records}));
const candidate=parsePrepareNeedsOutput(strings(result).find(t=>t.includes('SIGAP_REFERENCE'))!);
const payload={...candidate,records:candidate.snapshot_records};
const text=`Mohon klarifikasi laporan R002 (Posko Harapan) batch ${source.batch_id}: laki lakinya 43 lansianya 16`;
const repo=new SigapRepository(':memory:');const session=repo.createSession('synthetic-smoke');
const prior=repo.createBatch({sessionId:session.session_id,requestId:'seed',contextId:'smoke',sourceSha256:'a'.repeat(64),sourceLength:1,filteredText:'Synthetic demo',piiSummary:{}});
repo.saveSnapshot({snapshotId:candidate.snapshot_id,snapshotSha256:candidate.snapshot_sha256,batchId:prior.batch_id,version:1,qualityStatus:'PARSIAL',payload});
repo.updateBatchStatus(prior.batch_id,'ready_for_review');
const runtime=new GeminiAgentRuntime(loadGeminiSettings());const observed:any[]=[];
const allowed=['prepare_needs','validate_needs','calculate_gap','flag_anomalies'];
const wrapped:AgentRuntime={provider:'gemini',isAvailable:()=>runtime.isAvailable(),initSession:c=>runtime.initSession(c),closeSession:id=>runtime.closeSession(id),
  sendPrompt:(options,onEvent,gate)=>runtime.sendPrompt(options,event=>{observed.push(event);onEvent(event);},async(id,call)=>{
    if(!allowed.includes(canonicalToolName(call.toolName)!))return {allow:false,reason:'Synthetic preview only; stored data, writes and documents denied'};
    return gate!(id,call);
  })};
const orchestrator=new BatchOrchestrator(repo,wrapped,loadAgentSessionConfig('gemini'));
const batch=repo.createBatch({sessionId:session.session_id,requestId:'test',contextId:'smoke',sourceSha256:'b'.repeat(64),sourceLength:text.length,filteredText:text,piiSummary:{}});
try{
  await orchestrator.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'smoke',filteredText:text});
  writeFileSync('../output/correction-model-synthetic-smoke.json',JSON.stringify(observed,null,2));
  const status=repo.getBatch(batch.batch_id)!.status;
  const preview=JSON.parse(repo.getBatch(batch.batch_id)!.preview_payload_json||'{}');
  const row=preview.records?.find((r:any)=>r.shelter_name==='Posko Harapan');
  console.log(JSON.stringify({status,records:preview.records?.length,male:row?.male,elderly:row?.elderly,storageWrites:0}));
  if(status!=='ready_for_review'||preview.records?.length!==6||row?.male!==43||row?.elderly!==16)process.exitCode=1;
}finally{await runtime.shutdown();repo.close();}
