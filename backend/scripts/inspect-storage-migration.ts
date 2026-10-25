import '../src/config.js';
import {loadAgentSessionConfig} from '../src/acp/sessionConfig.js';
import {McpHttpClient} from '../src/mcp/httpClient.js';
import {canonicalToolName} from '../src/acp/toolNames.js';
import {parseSigapReadResult} from '../src/pipeline/toolResults.js';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
const server=loadAgentSessionConfig('gemini').mcpServerConfig.find((s:any)=>s.name==='langflow');
const headers=Object.fromEntries(server.headers.map((h:any)=>[h.name,h.value]));
const client=new McpHttpClient({url:server.url,headers});
try{
  await client.initialize();const tool=(await client.listTools()).find(t=>canonicalToolName(t.name)==='fetch_shelters')!;
  const raw=await client.callTool(tool.name,{input_value:'{"action":"all"}'});
  const read=parseSigapReadResult(raw.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'));
  const response=await fetch(new URL('/api/v1/flows/?get_all=true',server.url),{headers});
  const body:any=response.ok?await response.json():null;
  const flows=Array.isArray(body)?body:body?.flows||[];
  mkdirSync('../output/testing/storage-migration',{recursive:true});
  if(!existsSync('../output/testing/storage-migration/source-readback.json'))writeFileSync('../output/testing/storage-migration/source-readback.json',JSON.stringify(read,null,2));
  if(!existsSync('../output/testing/storage-migration/active-flows.json'))writeFileSync('../output/testing/storage-migration/active-flows.json',JSON.stringify(flows));
  writeFileSync('../output/testing/storage-migration/latest-readback.json',JSON.stringify(read,null,2));
  const summary={source:read.source,count:read.records?.length,flow_api_status:response.status,flows:flows.map((f:any)=>({id:f.id,name:f.name,endpoint_name:f.endpoint_name,nodes:f.data?.nodes?.length}))};
  writeFileSync('../output/testing/storage-migration/discovery.json',JSON.stringify(summary,null,2));
  console.log(JSON.stringify({source_kind:String(read.source).split(':')[0],count:read.records?.length,flow_api_status:response.status,sigap_flows:summary.flows.filter((f:any)=>f.endpoint_name)},null,2));
}finally{await client.close();}
