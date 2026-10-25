import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {call,done,scriptedModel,scenarioMcp} from './helpers/geminiScenario.js';
import {GeminiUnavailableError} from '../src/gemini/errors.js';

test('terminal validator reasons reach UI events even when model stops or exhausts repairs',async()=>{
  for(const stop of [false,true]){
    const reason='GAGAL: Nama posko koreksi tidak cocok dengan baris asal.';
    const mcp=await scenarioMcp(name=>name==='sigap_2_validate_needs'?{content:[{type:'text',text:reason}]}:undefined);
    const validate=()=>call('sigap_2_validate_needs',{input_value:'{"batch_id":"source","source_sha256":"hash","records":[]}'});
    const script=scriptedModel([call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),validate(),...(stop?[done]:[validate(),validate()])]);
    const runtime=new GeminiAgentRuntime({apiKey:'synthetic-key',model:'gemini-3.8-flash'},script.model);
    const repo=new SigapRepository(':memory:');const session=repo.createSession('test');
    const batch=repo.createBatch({sessionId:session.session_id,requestId:'test',contextId:'test',sourceSha256:'a'.repeat(64),sourceLength:19,filteredText:'Posko Uji 10 jiwa.',piiSummary:{}});
    const orchestrator=new BatchOrchestrator(repo,runtime,{systemPrompt:'Synthetic test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    try{
      await orchestrator.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'test',filteredText:'Posko Uji 10 jiwa.'});
      const events=repo.getEventsAfter(session.session_id).map(e=>({type:e.event_type,payload:JSON.parse(e.payload_json)}));
      const errors=events.filter(e=>e.type==='error');
      assert.equal(errors.length,1);
      assert.equal(errors[0].payload.code,'TOOL_VALIDATION_FAILED');
      assert.equal(errors[0].payload.message,reason);
      assert.equal(events.some(e=>e.type==='preview_ready'||e.type==='assistant_message'),false);
      assert.equal(repo.getBatch(batch.batch_id)!.status,'failed');
    }finally{await orchestrator.shutdown();repo.close();await mcp.close();}
  }
});

test('provider 503 reaches UI, preserves prior candidate and session, and never replays tool writes',async()=>{
  const mcp=await scenarioMcp();
  const script=scriptedModel([call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),call('sigap_2_validate_needs',{input_value:'{"batch_id":"source","source_sha256":"hash","records":[]}'}),done,async()=>{throw new GeminiUnavailableError();},done]);
  const runtime=new GeminiAgentRuntime({apiKey:'synthetic-key',model:'test'},script.model);
  const repo=new SigapRepository(':memory:');const session=repo.createSession('test');
  const orchestrator=new BatchOrchestrator(repo,runtime,{systemPrompt:'Synthetic test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
  const create=()=>repo.createBatch({sessionId:session.session_id,requestId:crypto.randomUUID(),contextId:'test',sourceSha256:'a'.repeat(64),sourceLength:19,filteredText:'Posko Uji 10 jiwa.',piiSummary:{}});
  const run=async(batch:ReturnType<typeof create>)=>orchestrator.processBatchMessage({sessionId:session.session_id,batchId:batch.batch_id,requestId:batch.request_id,contextId:'test',filteredText:'Posko Uji 10 jiwa.'});
  try{
    const first=create();await run(first);
    assert.equal(repo.getBatch(first.batch_id)?.status,'ready_for_review');
    const failed=create();await run(failed);
    const events=repo.getEventsAfter(session.session_id).map(e=>({type:e.event_type,payload:JSON.parse(e.payload_json)}));
    assert.equal(events.find(e=>e.type==='error')?.payload.code,'GEMINI_UNAVAILABLE');
    assert.equal(repo.getBatch(first.batch_id)?.status,'ready_for_review','previous candidate remains reviewable');
    const retry=create();await run(retry);
    assert.equal(repo.getBatch(retry.batch_id)?.status,'conversation_done');
    assert.equal(mcp.requests.filter(r=>r.method==='initialize').length,1,'same session survives provider outage');
    assert.equal(mcp.requests.some(r=>r.params?.name==='sigap_5_upsert_shelter'),false);
    assert.equal(script.inputs[4].contents.length,script.inputs[3].contents.length,'failed operation does not append partial history');
  }finally{await orchestrator.shutdown();repo.close();await mcp.close();}
});
