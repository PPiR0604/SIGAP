// Initialize/list only: this probe never executes a workflow.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {McpHttpClient} from '../src/mcp/httpClient.js';
async function main(){
  const path=process.env.SIGAP_MCP_CONFIG_PATH;
  if(!path)throw new Error('SIGAP_MCP_CONFIG_PATH diperlukan.');
  const config=JSON.parse(readFileSync(resolve(path),'utf8'));
  const server=config.mcpServers?.langflow;
  const client=new McpHttpClient({url:server?.url,headers:server?.headers||{},timeoutMs:15000});
  try{
    await client.initialize();
    const tools=await client.listTools();
    const output=resolve(process.env.SIGAP_MCP_PROBE_OUTPUT||'../output/mcp-readonly-probe.json');
    const result={checked_at:new Date().toISOString(),toolCount:tools.length,tools};
    mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2));
    console.log(JSON.stringify({toolCount:tools.length,toolNames:tools.map(t=>t.name),output},null,2));
  }finally{await client.close();}
}
main().catch(()=>{console.error('Probe MCP gagal. Periksa konfigurasi lokal dan server.');process.exitCode=1;});
