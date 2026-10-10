import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {GoogleGenAI} from '@google/genai';
import {GeminiApiClient} from '../src/gemini/client.js';
test('Gemini SDK boundary sends manual tools and preserves model content without retrying API errors',async()=>{
  let mode='success';const requests:any[]=[];
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;requests.push(JSON.parse(text));res.setHeader('content-type','application/json');
    if(mode==='error'){res.writeHead(429);res.end(JSON.stringify({error:{code:429,message:'private-key'}}));return;}
    if(mode==='blocked'){res.end(JSON.stringify({promptFeedback:{blockReason:'SAFETY'}}));return;}
    if(mode==='empty'){res.end(JSON.stringify({candidates:[]}));return;}
    res.end(JSON.stringify({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{thoughtSignature:'opaque',functionCall:{name:'sigap_0_fetch_shelters',args:{input_value:'{}'}}}]}}]}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const sdk=new GoogleGenAI({apiKey:'synthetic-key',httpOptions:{baseUrl:`http://127.0.0.1:${(server.address() as any).port}`}});
  const client=new GeminiApiClient({apiKey:'synthetic-key',model:'gemini-3.8-flash'},sdk);
  try{
    const turn=await client.generate([{role:'user',parts:[{text:'Hello'}]}],[{name:'sigap_0_fetch_shelters',inputSchema:{type:'object'}}],'Instruction',new AbortController().signal);
    assert.equal(turn.parts[0].thoughtSignature,'opaque');
    assert.equal(requests[0].tools[0].functionDeclarations[0].name,'sigap_0_fetch_shelters');
    for(const failure of ['error','blocked','empty']){
      mode=failure;const before=requests.length;
      await assert.rejects(client.generate([{role:'user',parts:[{text:'Hello'}]}],[],'Instruction',new AbortController().signal),e=>!String(e).includes('private-key'));
      assert.equal(requests.length-before,1);
    }
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
