import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {BatchOrchestrator} from '../src/pipeline/orchestrator.js';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {call,done,scriptedModel,scenarioMcp} from './helpers/geminiScenario.js';

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
