import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createWatsonxClient,loadWatsonxSettings} from '../src/watsonx/runtime.js';

test('watsonx exchanges IAM key, sends project and tools, and reuses token',async()=>{
  const calls:Array<{url:string;init:RequestInit}>=[];
  const request:typeof fetch=async (input,init)=>{
    calls.push({url:String(input),init:init!});
    if(String(input).includes('iam.cloud.ibm.com')) return Response.json({access_token:'fake-token',expires_in:3600});
    return Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'call1',type:'function',function:{name:'read_shelter',arguments:JSON.stringify('{"id":"1"}')}}]}}]});
  };
  const client=createWatsonxClient({baseUrl:'https://us-south.ml.cloud.ibm.com',projectId:'project',apiKey:'fake-key',model:'ibm/granite-4-h-small'},request);
  const tool={name:'read_shelter',description:'Read',inputSchema:{type:'object',properties:{id:{type:'string'}}}};
  const call=()=>client.generate([{role:'user',parts:[{text:'test'}]}],[tool],'instruction',new AbortController().signal);
  const first=await call(); await call();
  assert.equal((first.parts[0].functionCall as any).name,'read_shelter');
  assert.equal((first.parts[0].functionCall as any).args.id,'1');
  assert.equal(calls.length,3);
  assert.match(calls[1].url,/\/ml\/v1\/text\/chat\?version=/);
  const payload=JSON.parse(String(calls[1].init.body));
  assert.equal(payload.project_id,'project'); assert.equal(payload.model,'ibm/granite-4-h-small');
  assert.equal(payload.tool_choice_option,'auto'); assert.equal(payload.tool_choice,undefined);
  assert.equal((calls[1].init.headers as Record<string,string>).Authorization,'Bearer fake-token');
  assert.ok(!String(calls[1].init.body).includes('fake-key'));
});

test('watsonx settings reject non-IBM endpoints',()=>{
  const names=['SIGAP_WATSONX_URL','SIGAP_WATSONX_PROJECT_ID','SIGAP_WATSONX_API_KEY'];
  const old=names.map(n=>process.env[n]);
  try {process.env.SIGAP_WATSONX_URL='https://example.com';process.env.SIGAP_WATSONX_PROJECT_ID='project';process.env.SIGAP_WATSONX_API_KEY='fake';assert.throws(()=>loadWatsonxSettings(),/IBM Cloud/);}
  finally {names.forEach((n,i)=>{if(old[i]===undefined)delete process.env[n];else process.env[n]=old[i];});}
});

test('watsonx identifies IAM network failures without exposing credentials',async()=>{
  const client=createWatsonxClient({baseUrl:'https://us-south.ml.cloud.ibm.com',projectId:'project',apiKey:'sensitive-fixture-key',model:'ibm/granite-4-h-small'},async()=>{throw new Error('network');});
  await assert.rejects(client.generate([{role:'user',parts:[{text:'test'}]}],[],'instruction',new AbortController().signal),error=>{
    assert.match(String(error),/IBM IAM/);
    assert.doesNotMatch(String(error),/sensitive-fixture-key/);
    return true;
  });
});
