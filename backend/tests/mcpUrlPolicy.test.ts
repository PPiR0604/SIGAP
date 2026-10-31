import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateMcpUrl} from '../src/mcp/urlPolicy.js';
import {McpHttpClient} from '../src/mcp/httpClient.js';

test('remote MCP requires an exact configured HTTPS origin',()=>{
  const origin='https://sigap-mcp.example.test';
  assert.equal(validateMcpUrl(origin+'/mcp',origin).href,origin+'/mcp');
  assert.throws(()=>validateMcpUrl(origin+'/mcp',''));
  for(const target of ['http://sigap-mcp.example.test/mcp','https://sigap-mcp.example.test.attacker.test/mcp','https://other.example.test/mcp','https://sigap-mcp.example.test:444/mcp','https://user:secret@sigap-mcp.example.test/mcp',origin+'/mcp?key=secret',origin+'/mcp#fragment'])assert.throws(()=>validateMcpUrl(target,origin),target);
});
test('local MCP keeps working and invalid allowlist entries fail closed',()=>{
  for(const host of ['localhost','127.0.0.1','[::1]','host.docker.internal'])assert.equal(validateMcpUrl('http://'+host+':7860/mcp','').protocol,'http:');
  for(const value of ['*.example.test','https://example.test/path','http://example.test','https://user:pass@example.test','https://example.test?secret=key'])assert.throws(()=>validateMcpUrl('https://example.test/mcp',value));
});
test('HTTP transport applies the same remote policy as session configuration',async()=>{
  const previous=process.env.SIGAP_MCP_ALLOWED_ORIGINS;
  try{process.env.SIGAP_MCP_ALLOWED_ORIGINS='https://sigap-mcp.example.test';const client=new McpHttpClient({url:'https://sigap-mcp.example.test/mcp',headers:{'x-api-key':'fixture'}});await client.close();assert.throws(()=>new McpHttpClient({url:'https://other.example.test/mcp',headers:{}}));}
  finally{if(previous===undefined)delete process.env.SIGAP_MCP_ALLOWED_ORIGINS;else process.env.SIGAP_MCP_ALLOWED_ORIGINS=previous;}
});
