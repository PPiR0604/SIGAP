import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storageReaderInput} from '../src/pipeline/readerInput.js';
import {parseSigapReadResult} from '../src/pipeline/toolResults.js';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {scenarioMcp,scriptedModel,id,sha} from './helpers/geminiScenario.js';

test('reader transport and inline calculation are negotiated independently',()=>{
 assert.deepEqual(storageReaderInput(undefined,true),{action:'all'});
 assert.deepEqual(storageReaderInput('sigap:validated-calculation-v1',true),{action:'all',include_calculation:true});
 assert.deepEqual(storageReaderInput('sigap:compact-read-result-v1',true),{action:'all',response_format:'compact'});
 assert.deepEqual(storageReaderInput('sigap:compact-read-result-v1 sigap:validated-calculation-v1',true),{action:'all',include_calculation:true,response_format:'compact'});
 assert.deepEqual(storageReaderInput('sigap:compact-read-result-v1 sigap:validated-calculation-v1'),{action:'all',response_format:'compact'});
});

test('compact reader preserves records, provenance and write-verification differences through duplicate MCP copies',()=>{
 for(const status of ['not_requested','verified','mismatch']){
  const data={status:'ok',source:'Supabase',total_shelters:1,matched_shelters:1,snapshot_id:id,snapshot_sha256:sha,
   verification_status:status,verification:{status,differences:[{field:'total_people',expected:0,observed:12}]},
   records:[{shelter_name:'Posko Ω',total_people:0,notes:'Baris satu\nBaris dua',stock:{air_liter_per_hari:0},field_provenance:{total_people:{source_report_id:'R001',value:0}},pending_clear_fields:['notes']}],
   validated_calculation:{snapshot_id:id,snapshot_sha256:sha,shelters:[{total_people:0}],totals:{air_liter_per_hari:0}}};
  const compact='SIGAP_READ_RESULT '+JSON.stringify(data);
  const human='SIGAP_READ_RESULT '+JSON.stringify({status:'ok',verification_status:status})+'\nRingkasan\n```json\n'+JSON.stringify(data,null,2)+'\n```';
  assert.deepEqual(parseSigapReadResult(compact+'\n'+compact),parseSigapReadResult(human));
  assert.equal(parseSigapReadResult(compact).verification?.status,status);
 }
});

test('runtime requests compact rekap only when advertised and still secures its input',async()=>{
 for(const description of ['legacy reader','sigap:compact-read-result-v1 sigap:validated-calculation-v1']){
  const data={status:'source_empty',total_shelters:0,matched_shelters:0,records:[],verification:{status:'not_requested'}};
  const mcp=await scenarioMcp(()=>({content:[{type:'text',text:'SIGAP_READ_RESULT '+JSON.stringify(data)}]}),{'sigap_0_fetch_shelters':description});
  const model=scriptedModel([]),runtime=new GeminiAgentRuntime({apiKey:'synthetic-test-key',model:'fixture'},model.model);let secured=0;
  try{
   await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}],secureToolInput:async(name,args)=>{secured++;assert.equal(name,'sigap_0_fetch_shelters');return args;}});
   const result=await runtime.readStoredRekap('one',undefined,{includeCalculation:true});
   assert.ok(result);assert.equal(parseSigapReadResult(result.content[0].text!).status,'source_empty');
   const request=mcp.requests.find(r=>r.method==='tools/call');
   assert.deepEqual(JSON.parse(request.params.arguments.input_value),storageReaderInput(description,true));
   assert.equal(secured,1);assert.equal(model.inputs.length,0);
  }finally{await runtime.shutdown();await mcp.close();}
 }
});
