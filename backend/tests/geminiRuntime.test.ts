import {test} from 'node:test';import assert from 'node:assert/strict';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {call,done,scriptedModel,scenarioMcp} from './helpers/geminiScenario.js';
const options={sessionId:'one',batchId:'batch',requestId:'request',prompt:'Laporan sintetis',operation:'prepare' as const};
const settings={apiKey:'synthetic-test-key',model:'gemini-3.8-flash'};
const allow=async()=>({allow:true});

test('Gemini runs source preparation and validator without losing opaque content',async()=>{
  const mcp=await scenarioMcp();const script=scriptedModel([call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),call('sigap_2_validate_needs',{input_value:'{"batch_id":"source","source_sha256":"hash","records":[]}'}),done]);
  const runtime=new GeminiAgentRuntime(settings,script.model);const events:any[]=[];
  try{
    await runtime.initSession({sessionId:'one',contextId:'test',systemPrompt:'Instruksi Gemini',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await runtime.sendPrompt(options,e=>events.push(e),allow);
    assert.deepEqual(events.filter(e=>['preview_ready','stage_changed'].includes(e.event_type)).map(e=>e.payload.stage||e.event_type),['tool:sigap_1_prepare_needs','source_prepared','tool:sigap_2_validate_needs','preview_ready']);
    assert.equal(script.inputs[1].contents[1].parts[0].thoughtSignature,'opaque-signed-data');
    assert.equal((script.inputs[1].contents[2].parts[0] as any).functionResponse.id,'call');
    assert.equal(script.inputs[0].tools.some(t=>t.name==='sigap_5_upsert_shelter'),false);
    assert.equal(events.filter(e=>e.event_type==='preview_ready').length,1);
  }finally{await runtime.shutdown();await mcp.close();}
});

test('Gemini validates SOURCE_REF after Langflow extraction instructions',async()=>{
  const mcp=await scenarioMcp(name=>name==='sigap_1_prepare_needs'?{content:[{type:'text',text:'Instruksi ekstraksi\nLAPORAN POSKO:\n<<<SOURCE_REF>>>{"batch_id":"source","source_sha256":"hash"}<<<END_SOURCE_REF>>>\nPosko Uji 10 jiwa.'}]}:undefined);
  const script=scriptedModel([call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),call('sigap_2_validate_needs',{input_value:'{"batch_id":"source","source_sha256":"hash","records":[]}'}),done]);
  const runtime=new GeminiAgentRuntime(settings,script.model);const events:any[]=[];
  try{
    await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await runtime.sendPrompt(options,e=>events.push(e),allow);
    assert.deepEqual(mcp.requests.filter(r=>r.method==='tools/call').map(r=>r.params.name),['sigap_1_prepare_needs','sigap_2_validate_needs']);
    assert.equal(events.filter(e=>e.event_type==='preview_ready').length,1);
    assert.equal(events.find(e=>e.payload.stage==='source_prepared')?.event_type,'stage_changed');
  }finally{await runtime.shutdown();await mcp.close();}
});

test('rejected read-only extraction can be repaired against the same source before emitting a preview',async()=>{
  let validations=0;
  const mcp=await scenarioMcp(name=>name==='sigap_2_validate_needs'&&++validations===1?{content:[{type:'text',text:'GAGAL: Nama posko koreksi tidak cocok dengan baris asal.'}]}:undefined);
  const validate=()=>call('sigap_2_validate_needs',{input_value:'{"batch_id":"source","source_sha256":"hash","records":[]}'});
  const script=scriptedModel([call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),validate(),validate(),done]);
  const runtime=new GeminiAgentRuntime(settings,script.model);const events:any[]=[];
  try{
    await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await runtime.sendPrompt(options,e=>events.push(e),allow);
    assert.equal(events.filter(e=>e.event_type==='preview_ready').length,1);
    assert.equal(events.filter(e=>e.event_type==='error').length,0);
    assert.match(JSON.stringify(script.inputs[2].contents),/TOOL_VALIDATION_FAILED/);
    assert.match(JSON.stringify(script.inputs[2].contents),/Nama posko/);
    assert.equal(validations,2);
  }finally{await runtime.shutdown();await mcp.close();}
});

test('persistent extraction rejection stops after three attempts and never emits a false preview',async()=>{
  let attempts=0;
  const mcp=await scenarioMcp(name=>name==='sigap_2_validate_needs'?(attempts++,{content:[{type:'text',text:'GAGAL: Nama posko tidak cocok.'}]}):undefined);
  const validate=()=>call('sigap_2_validate_needs',{input_value:'{"batch_id":"source","source_sha256":"hash","records":[]}'});
  const script=scriptedModel([call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),validate(),validate(),validate(),validate()]);
  const runtime=new GeminiAgentRuntime(settings,script.model);const events:any[]=[];
  try{
    await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await assert.rejects(runtime.sendPrompt(options,e=>events.push(e),allow),/Nama posko tidak cocok/);
    assert.equal(attempts,3);
    assert.equal(events.filter(e=>e.event_type==='preview_ready').length,0);
  }finally{await runtime.shutdown();await mcp.close();}
});
test('unknown, unapproved and absent-gate calls produce no MCP dispatch',async()=>{
  const mcp=await scenarioMcp();const script=scriptedModel([call('delete_database'),call('sigap_5_upsert_shelter'),call('sigap_0_fetch_shelters'),done]);
  const runtime=new GeminiAgentRuntime(settings,script.model);
  try{
    await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await assert.rejects(runtime.sendPrompt(options,()=>{}),/gerbang/);
    await runtime.sendPrompt(options,()=>{},async()=>({allow:false}));
    assert.equal(mcp.requests.filter(r=>r.method==='tools/call').length,0);
    assert.equal(script.inputs[3].contents.filter(t=>t.role==='user').length,4);
  }finally{await runtime.shutdown();await mcp.close();}
});
test('writer network failure cannot be retried by the model',async()=>{
  const mcp=await scenarioMcp((name,_args,res)=>{if(name==='sigap_5_upsert_shelter'){res.destroy();return null;}return undefined;});
  const script=scriptedModel([call('sigap_5_upsert_shelter'),call('sigap_5_upsert_shelter')]);const runtime=new GeminiAgentRuntime(settings,script.model);
  try{
    await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await assert.rejects(runtime.sendPrompt({...options,operation:'commit'},()=>{},allow));
    assert.equal(mcp.requests.filter(r=>r.method==='tools/call').length,1);
    assert.equal(script.inputs.length,1);
  }finally{await runtime.shutdown();await mcp.close();}
});
test('Gemini enforces operation budgets, malformed calls and tool errors',async()=>{
  for(const mode of ['rounds','calls','history','error','malformed','timeout']){
    const mcp=await scenarioMcp(()=>mode==='error'?{isError:true,content:[{type:'text',text:'secret'}]}:undefined);
    const script=scriptedModel(mode==='timeout'?[async()=>new Promise(()=>{})]:mode==='history'?[{role:'model',parts:[{text:'x'.repeat(2000)}]}]:mode==='malformed'?[call('sigap_0_fetch_shelters','bad')]:[call('sigap_0_fetch_shelters'),call('sigap_0_fetch_shelters')]);
    const runtime=new GeminiAgentRuntime(settings,script.model,{maxRounds:mode==='rounds'?1:12,maxToolCalls:mode==='calls'?1:24,maxHistoryBytes:mode==='history'?1000:1048576,operationTimeoutMs:mode==='timeout'?30:300000});
    try{
      await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
      await assert.rejects(runtime.sendPrompt(options,()=>{},allow),e=>!String(e).includes('secret'),mode);
    }finally{await runtime.shutdown();await mcp.close();}
  }
});
test('Gemini locks one session before awaiting and close cancels its pending operation',async()=>{
  const mcp=await scenarioMcp();let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  const script=scriptedModel([async()=>{started();return new Promise(()=>{});}]);const runtime=new GeminiAgentRuntime(settings,script.model);
  try{
    await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    const first=runtime.sendPrompt(options,()=>{},allow);const firstRejected=assert.rejects(first);
    await ready;
    await assert.rejects(runtime.sendPrompt(options,()=>{},allow),/sedang/);
    await runtime.closeSession('one');await firstRejected;
  }finally{await runtime.shutdown();await mcp.close();}
});

test('Gemini source text and validator reference must belong to this operation',async()=>{
  const mcp=await scenarioMcp();
  const script=scriptedModel([call('sigap_1_prepare_needs',{input_value:'Different source'}),call('sigap_1_prepare_needs',{input_value:'Original source'}),call('sigap_2_validate_needs',{input_value:'{"batch_id":"another","source_sha256":"hash","records":[]}'}),done]);
  const runtime=new GeminiAgentRuntime(settings,script.model);
  try{
    await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await runtime.sendPrompt({...options,filteredText:'Original source'},()=>{},allow);
    const requests=mcp.requests.filter(r=>r.method==='tools/call');
    assert.equal(requests.length,1);assert.equal(requests[0].params.arguments.input_value,'Original source');
  }finally{await runtime.shutdown();await mcp.close();}
});

test('shutdown cancels initialization and forbids creating another runtime session',async()=>{
  const mcp=await scenarioMcp();const runtime=new GeminiAgentRuntime(settings,scriptedModel([done]).model);
  try{
    const config={sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]};
    const pending=runtime.initSession(config);const rejected=assert.rejects(pending);
    await runtime.shutdown();await rejected;
    await assert.rejects(runtime.initSession({...config,sessionId:'two'}));
  }finally{await runtime.shutdown();await mcp.close();}
});

test('parallel Gemini sessions keep model history and instructions isolated',async()=>{
  const mcp=await scenarioMcp();
  const observed:Array<{contents:any;instruction:string}>=[];
  let release!:()=>void;const bothStarted=new Promise<void>(resolve=>release=resolve);
  const runtime=new GeminiAgentRuntime(settings,{generate:async(contents,_tools,instruction)=>{
    observed.push({contents:structuredClone(contents),instruction});
    if(observed.length===2)release();
    await bothStarted;
    return done;
  }});
  try{
    for(const sessionId of ['one','two'])await runtime.initSession({sessionId,contextId:'test',systemPrompt:'instruction-'+sessionId,mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await Promise.all(['one','two'].map(sessionId=>runtime.sendPrompt({...options,sessionId,prompt:'private-'+sessionId},()=>{},allow)));
    assert.deepEqual(observed.map(({contents,instruction})=>({instruction,text:contents[0].parts[0].text,turns:contents.length})),[
      {instruction:'instruction-one',text:'private-one',turns:1},
      {instruction:'instruction-two',text:'private-two',turns:1},
    ]);
    assert.equal(mcp.requests.filter(r=>r.method==='tools/call').length,0);
  }finally{await runtime.shutdown();await mcp.close();}
});
