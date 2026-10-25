import {test} from 'node:test';
import assert from 'node:assert/strict';
import {csvReports} from '../src/pipeline/csvImport.js';
import {validateReportInput} from '../src/pipeline/inputValidation.js';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import type {AgentRuntime} from '../src/acp/types.js';
test('CSV preserves all villages, zero and quoted text with aliases for LLM/source validation',()=>{
  const result=csvReports('\uFEFFshelter_name,village,total_people,male,female,disability,urgent_needs\r\nPosko A,Desa A,10,4,6,0,"air, beras"\r\nPosko B,Desa B,20,9,11,,selimut');
  assert.equal(result.rows,2);assert.match(result.text,/posko: Posko A/);assert.match(result.text,/jumlah jiwa: 20/);assert.match(result.text,/disabilitas: 0/);
  assert.match(result.text,/air, beras/);assert.match(result.text,/---/);
  assert.equal(validateReportInput('a,b\n1,2','data.CSV').valid,true);
});
test('semicolon, escaped quotes, embedded newlines and timestamps remain source data',()=>{
  const result=csvReports('posko;desa;jumlah_jiwa;reported_at;catatan\nA;Desa A;10;2026-10-22 10:00;"Butuh ""air""\nsegera"');
  assert.match(result.text,/22\/10\/2026 10.00 - /);assert.match(result.text, /Butuh "air" \/ segera/);
});
test('malformed, duplicate, empty, oversized and mismatched CSV records are rejected',()=>{
  for(const text of ['posko,posko\nA,B','posko,desa\nA','posko,desa\n"A,B','posko,desa\n"A"x,B','posko,desa\n','data','posko,desa\n'+Array(101).fill('A,B').join('\n')])assert.throws(()=>csvReports(text));
  assert.throws(()=>csvReports('posko,desa\nA,B',10),/terlalu besar/);
});

test('an LLM dropping a CSV row cannot publish a partial import as a complete candidate',async()=>{
  const repo=new SigapRepository(':memory:');
  try{
    const session=repo.createSession(),batch=repo.createBatch({sessionId:session.session_id,requestId:'missing-row',contextId:'test',sourceSha256:'a'.repeat(64),sourceLength:1,filteredText:'data',piiSummary:{}});
    const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=>session.session_id,closeSession:async()=>{},sendPrompt:async(_,emit)=>emit({event_type:'preview_ready',session_id:session.session_id,batch_id:batch.batch_id,timestamp:new Date().toISOString(),payload:{rawOutput:JSON.stringify({snapshot_id:'a'.repeat(32),snapshot_sha256:'b'.repeat(64),records:[{report_id:'R001',shelter_name:'A'}]})}})};
    await new BatchOrchestrator(repo,runtime).processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'test',filteredText:'data',sourceFormat:'csv',expectedReportCount:2});
    assert.equal(repo.getBatch(batch.batch_id)?.status,'payload_invalid');
    assert.equal(repo.getBatch(batch.batch_id)?.latest_snapshot_id,null);
  }finally{repo.close();}
});
