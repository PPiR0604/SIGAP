import {test} from 'node:test';
import assert from 'node:assert/strict';
import {McpHttpClient} from '../src/mcp/httpClient.js';
import {mcpServer} from './helpers/mcpServer.js';

test('MCP pagination correlates JSON/SSE responses and finishes an open SSE response',async()=>{
  const fixture=await mcpServer((message,res,req)=>{
    if(message.method==='initialize'){
      res.setHeader('mcp-session-id','session-one');res.setHeader('content-type','application/json');
      res.end(JSON.stringify({id:message.id,result:{protocolVersion:'2025-03-26'}}));return;
    }
    assert.equal(req.headers['mcp-session-id'],'session-one');
    assert.equal(req.headers['mcp-protocol-version'],'2025-03-26');
    if(message.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
    if(!message.params.cursor){res.setHeader('content-type','application/json');res.end(JSON.stringify({id:message.id,result:{tools:[{name:'sigap_1_prepare_needs',inputSchema:{type:'object'}}],nextCursor:'second'}}));}
    else{
      res.setHeader('content-type','text/event-stream');
      res.write(`data: ${JSON.stringify({id:99999,result:{tools:[]}})}\r\n\r\n`);
      res.write(`data: ${JSON.stringify({id:message.id,result:{tools:[{name:'sigap_2_validate_needs',inputSchema:{type:'object'}}]}})}\r\n\r\n`);
    }
  });
  const client=new McpHttpClient({url:fixture.url,headers:{'x-api-key':'synthetic'},timeoutMs:500});
  try{await client.initialize();assert.deepEqual((await client.listTools()).map(t=>t.name),['sigap_1_prepare_needs','sigap_2_validate_needs']);}
  finally{await client.close();await fixture.close();}
});
test('writer timeout is not retried and does not expose credentials',async()=>{
  const fixture=await mcpServer((message,res)=>{if(message.method==='tools/call')return;res.setHeader('content-type','application/json');res.end(JSON.stringify({id:message.id,result:{protocolVersion:'2025-03-26'}}));});
  const client=new McpHttpClient({url:fixture.url,headers:{'x-api-key':'private-key'},timeoutMs:50});
  try{await assert.rejects(client.callTool('sigap_5_upsert_shelter',{}),error=>!String(error).includes('private-key'));assert.equal(fixture.requests.filter(r=>r.method==='tools/call').length,1);}
  finally{await client.close();await fixture.close();}
});
test('MCP rejects remote URLs, redirects, invalid responses and oversized bodies',async()=>{
  assert.throws(()=>new McpHttpClient({url:'https://example.com/mcp',headers:{}}),/loopback/);
  for(const scenario of ['redirect','malformed','wrong-id','oversize','unauthorized','expired','error']){
    const fixture=await mcpServer((message,res)=>{
      res.setHeader('content-type','application/json');
      if(scenario==='redirect'){res.writeHead(302,{Location:'http://example.com'});res.end();}
      else if(scenario==='unauthorized'){res.writeHead(401);res.end('private-key');}
      else if(scenario==='expired'){res.writeHead(404);res.end('private-key');}
      else if(scenario==='malformed')res.end('{ private-key');
      else if(scenario==='oversize')res.end('x'.repeat(2*1024*1024+1));
      else res.end(JSON.stringify({id:scenario==='wrong-id'?10000:message.id,...(scenario==='error'?{error:{code:-32000,message:'private-key'}}:{result:{}})}));
    });
    const client=new McpHttpClient({url:fixture.url,headers:{},timeoutMs:500});
    try{await assert.rejects(client.callTool('sigap_0_fetch_shelters',{}),e=>!String(e).includes('private-key'),scenario);}
    finally{await client.close();await fixture.close();}
  }
});
test('MCP pagination cycles and aborts cannot silently complete',async()=>{
  const fixture=await mcpServer((message,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({id:message.id,result:{tools:[],nextCursor:'same'}}));});
  const client=new McpHttpClient({url:fixture.url,headers:{}});
  try{await assert.rejects(client.listTools(),/pagination/);const controller=new AbortController();controller.abort();await assert.rejects(client.callTool('sigap_0_fetch_shelters',{},controller.signal));}
  finally{await client.close();await fixture.close();}
});
