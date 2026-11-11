import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {scenarioMcp,scriptedModel} from './helpers/geminiScenario.js';

function deferred(){let resolve!:(value?:any)=>void,reject!:(reason:Error)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

async function fixture(){
  const mcp=await scenarioMcp(),script=scriptedModel([]),runtime=new GeminiAgentRuntime({apiKey:'test',model:'test'},script.model);
  const progress=deferred(),secure=deferred(),progressStarted=deferred(),secureStarted=deferred();
  let done=false,secureCalls=0;
  await runtime.initSession({sessionId:'dispatch',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}],secureToolInput:async(_name,args)=>{secureCalls++;secureStarted.resolve();await secure.promise;return {...args,authorized:true};}});
  const start=(allow=true)=>runtime.sendPrompt({sessionId:'dispatch',batchId:'batch',requestId:'request',prompt:'',operation:'prepare',structuredRecord:{shelter_name:'Posko Uji',total_people:10},filteredText:'Posko Uji 10 jiwa'},async event=>{
    if(event.event_type==='stage_changed'&&event.payload.stage==='tool:sigap_1_prepare_needs'){progressStarted.resolve();await progress.promise;}
  },async()=>({allow,reason:'Denied'})).finally(()=>{done=true;});
  return {mcp,script,runtime,progress,secure,progressStarted,secureStarted,start,done:()=>done,secureCalls:()=>secureCalls,
    calls:()=>mcp.requests.filter(r=>r.method==='tools/call'),close:async()=>{progress.resolve();secure.resolve();await runtime.shutdown();await mcp.close();}};
}

test('progress and scoped input overlap; tool waits for both and receives exact authorized input',async()=>{
  const f=await fixture();try{
    const work=f.start();await f.progressStarted.promise;await f.secureStarted.promise;
    assert.equal(f.calls().length,0);assert.equal(f.script.inputs.length,0);
    f.secure.resolve();await Promise.resolve();assert.equal(f.calls().length,0);
    f.progress.resolve();await work;
    assert.deepEqual(f.calls().map(c=>c.params.name),['sigap_1_prepare_needs','sigap_2_validate_needs']);
    assert.equal(f.calls()[0].params.arguments.authorized,true);
    assert.equal(f.calls()[0].params.arguments.input_value,'Posko Uji 10 jiwa');
    assert.equal(f.script.inputs.length,0);
  }finally{await f.close();}
});

test('progress failure waits for authorization to settle and dispatches nothing',async()=>{
  const f=await fixture();try{
    const work=f.start(),rejected=assert.rejects(work,/Progress unavailable/);
    await f.progressStarted.promise;await f.secureStarted.promise;f.progress.reject(Error('Progress unavailable'));
    await Promise.resolve();assert.equal(f.done(),false);assert.equal(f.calls().length,0);
    f.secure.resolve();await rejected;assert.equal(f.calls().length,0);
  }finally{await f.close();}
});

test('authorization failure waits for progress to settle and dispatches nothing',async()=>{
  const f=await fixture();try{
    const work=f.start(),rejected=assert.rejects(work,/Scope revoked/);
    await f.progressStarted.promise;await f.secureStarted.promise;f.secure.reject(Error('Scope revoked'));
    await Promise.resolve();assert.equal(f.done(),false);assert.equal(f.calls().length,0);
    f.progress.resolve();await rejected;assert.equal(f.calls().length,0);
  }finally{await f.close();}
});

test('denied execution never starts input authorization or tool dispatch',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.start(false),/Denied/);assert.equal(f.calls().length,0);assert.equal(f.script.inputs.length,0);assert.equal(f.secureCalls(),0);
  }finally{await f.close();}
});
