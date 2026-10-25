import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OpenAIChatClient,chatMessages} from '../src/openai/client.js';
import {ModelProviderError} from '../src/openai/errors.js';
import {OpenAICompatibleRuntime} from '../src/openai/runtime.js';
import {call,done,scenarioMcp,scriptedModel} from './helpers/geminiScenario.js';

const settings={baseUrl:'http://localhost:20128/v1',apiKey:'synthetic-secret',model:'oc/deepseek-v4.1-flash-free'};

test('model effort suffix is sent as an API parameter while the configured name stays intact',async()=>{
  for(const [configured,model,effort] of [
    ['gemini/gemini-3.5-flash-lite(medium)','gemini/gemini-3.5-flash-lite','medium'],
    ['gemini/gemini-3.5-flash-lite','gemini/gemini-3.5-flash-lite',undefined],
    ['vendor/model(custom)','vendor/model(custom)',undefined]
  ]){
    const config={...settings,model:configured!};let body:any;
    const client=new OpenAIChatClient(config,async(_url,options)=>{
      body=JSON.parse(String(options?.body));
      return Response.json({choices:[{finish_reason:'stop',message:{content:'siap'}}]});
    });
    await client.generate([{role:'user',parts:[{text:'Synthetic'}]}],[],'Synthetic',new AbortController().signal);
    assert.equal(body.model,model);assert.equal(body.reasoning_effort,effort);
    assert.equal(Object.hasOwn(body,'reasoning_effort'),effort!==undefined);
    assert.equal(config.model,configured);
  }
});
test('Chat Completions preserves tool IDs, arguments, reasoning and responses without showing reasoning as text',async()=>{
  const requests:any[]=[];
  const client=new OpenAIChatClient(settings,async(url,options)=>{
    requests.push({url,options,body:JSON.parse(String(options?.body))});
    return Response.json({choices:[{finish_reason:'tool_calls',message:{content:null,reasoning_content:'private reasoning',tool_calls:[{id:'call-123',type:'function',function:{name:'sigap_0_fetch_shelters',arguments:'{"input_value":"{}"}'}}]}}]});
  });
  const turn=await client.generate([{role:'user',parts:[{text:'Read synthetic recap'}]}],[{name:'sigap_0_fetch_shelters',inputSchema:{type:'object'}}],'Synthetic',new AbortController().signal);
  assert.equal(requests[0].url,settings.baseUrl+'/chat/completions');
  assert.equal(requests[0].options.headers.Authorization,'Bearer synthetic-secret');
  assert.equal(requests[0].body.model,settings.model);assert.equal(requests[0].body.parallel_tool_calls,false);
  assert.equal(turn.parts.some(p=>p.text==='private reasoning'),false);
  const messages=chatMessages([turn,{role:'user',parts:[{functionResponse:{id:'call-123',name:'sigap_0_fetch_shelters',response:{result:'synthetic'}}}]}],'Synthetic');
  assert.equal(messages[1].reasoning_content,'private reasoning');assert.equal(messages[1].tool_calls[0].id,'call-123');
  assert.equal(messages[2].tool_call_id,'call-123');assert.equal(messages[2].role,'tool');
  assert.equal(JSON.stringify(messages).includes(settings.apiKey),false);
});
test('provider 503 retries at most once; auth, quota and malformed responses never execute tools or leak raw errors',async()=>{
  for(const status of [401,429,503]){
    let requests=0;
    const client=new OpenAIChatClient(settings,async()=>{requests++;return Response.json({error:{message:'private credentials'}},{status});});
    await assert.rejects(client.generate([{role:'user',parts:[{text:'Synthetic'}]}],[],'Synthetic',new AbortController().signal),error=>error instanceof ModelProviderError&&!String(error).includes('private'));
    assert.equal(requests,status===503?2:1);
  }
  let requests=0;
  const client=new OpenAIChatClient(settings,async()=>++requests===1?new Response('',{status:503}):Response.json({choices:[{finish_reason:'stop',message:{content:'ok'}}]}));
  assert.equal((await client.generate([{role:'user',parts:[{text:'Synthetic'}]}],[],'Synthetic',new AbortController().signal)).parts[0].text,'ok');
  assert.equal(requests,2);
  const malformed=new OpenAIChatClient(settings,async()=>Response.json({choices:[{finish_reason:'length',message:{tool_calls:[{type:'function',function:{name:'upsert_shelter',arguments:'{}'}}]}}]}));
  await assert.rejects(malformed.generate([{role:'user',parts:[{text:'Synthetic'}]}],[],'Synthetic',new AbortController().signal),ModelProviderError);
});
test('OpenAI provider uses the same source-bound MCP loop and never offers write before approval',async()=>{
  const mcp=await scenarioMcp();
  const script=scriptedModel([call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),call('sigap_2_validate_needs',{input_value:'{"batch_id":"source","source_sha256":"hash","records":[]}'}),done]);
  const runtime=new OpenAICompatibleRuntime(settings,script.model);const events:any[]=[];
  try{
    await runtime.initSession({sessionId:'test',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await runtime.sendPrompt({sessionId:'test',batchId:'batch',requestId:'req',operation:'prepare',prompt:'Synthetic',filteredText:'Posko Uji 10 jiwa.'},e=>events.push(e),async()=>({allow:true}));
    assert.equal(runtime.provider,'openai');assert.equal(runtime.model,settings.model);
    assert.equal(script.inputs.some(r=>r.tools.some(t=>t.name==='sigap_5_upsert_shelter')),false);
    assert.equal(mcp.requests.filter(r=>r.method==='tools/call').length,2);
    assert.equal(events.some(e=>e.event_type==='preview_ready'),true);
  }finally{await runtime.shutdown();await mcp.close();}
});
