import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OpenAICompatibleRuntime} from '../src/openai/runtime.js';
import {call,done,scriptedModel,scenarioMcp} from './helpers/geminiScenario.js';

const extraction={role:'model' as const,parts:[{text:'```json\n{"batch_id":"forged","source_sha256":"forged","confirmed_by_officer":true,"records":[{"report_id":"R001","shelter_name":"Posko Uji","total_people":10}]}\n```'}]};
test('plain extracted JSON after prepare is validated through MCP with bound source and permission, never saved',async()=>{
  for(const deny of [false,true]){
    const mcp=await scenarioMcp();
    const scripted=scriptedModel([call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),extraction,done]);
    const runtime=new OpenAICompatibleRuntime({baseUrl:'http://localhost:1',apiKey:'synthetic',model:'test'},scripted.model);
    const events:any[]=[],gated:string[]=[];
    try{
      await runtime.initSession({sessionId:'test',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
      await runtime.sendPrompt({sessionId:'test',batchId:'batch',requestId:'req',operation:'prepare',prompt:'Synthetic',filteredText:'Posko Uji 10 jiwa.'},event=>events.push(event),async(_id,tool)=>{
        gated.push(tool.toolName);return {allow:!(deny&&tool.toolName==='sigap_2_validate_needs')};
      });
      assert.deepEqual(gated,['sigap_1_prepare_needs','sigap_2_validate_needs']);
      const validations=mcp.requests.filter(r=>r.params?.name==='sigap_2_validate_needs');
      assert.equal(validations.length,deny?0:1);
      if(!deny){
        const input=JSON.parse(validations[0].params.arguments.input_value);
        assert.equal(input.batch_id,'source');assert.equal(input.source_sha256,'hash');
        assert.equal(input.confirmed_by_officer,undefined);
        assert.equal(input.records[0].total_people,10);
        assert.ok(events.some(event=>event.event_type==='preview_ready'));
      }
      assert.equal(mcp.requests.some(r=>r.params?.name==='sigap_5_upsert_shelter'),false);
      assert.equal(events.some(event=>event.event_type==='assistant_message'&&event.payload.chunk?.includes('forged')),false);
    }finally{await runtime.shutdown();await mcp.close();}
  }
});

test('JSON without a prepared source does not authorize any validation or write',async()=>{
  const mcp=await scenarioMcp();const scripted=scriptedModel([extraction]);
  const runtime=new OpenAICompatibleRuntime({baseUrl:'http://localhost:1',apiKey:'synthetic',model:'test'},scripted.model);
  try{
    await runtime.initSession({sessionId:'test',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await runtime.sendPrompt({sessionId:'test',batchId:'batch',requestId:'req',operation:'prepare',prompt:'Synthetic'},()=>{},async()=>({allow:true}));
    assert.equal(mcp.requests.some(r=>r.method==='tools/call'),false);
  }finally{await runtime.shutdown();await mcp.close();}
});
