// Synthetic MCP preparation + read-only stored recap. No model or canonical writer.
import {loadConfig} from '../src/config.js';
import {loadAgentSessionConfig} from '../src/acp/sessionConfig.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {AuthService,type Membership,type Principal} from '../src/auth/service.js';
import {McpHttpClient} from '../src/mcp/httpClient.js';
import {canonicalToolName} from '../src/acp/toolNames.js';
import {parseSigapReadResult} from '../src/pipeline/toolResults.js';

async function main(){
 const [userId,authSessionId,contextId,expiry]=process.argv.slice(2),expiresAt=Number(expiry);
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!uuid.test(userId||'')||!uuid.test(authSessionId||'')||!contextId||!Number.isFinite(expiresAt)||expiresAt<Date.now()+60000)throw new Error('Active identity arguments required');
 const config=loadConfig(),server=loadAgentSessionConfig('gemini').mcpServerConfig?.find((s:any)=>s.name==='langflow'&&s.type==='http');
 if(!config.supabase||!server)throw new Error('Configured services required');
 const host=new URL(server.url).hostname;
 if(!['localhost','127.0.0.1'].includes(host)&&!(process.env.SIGAP_DOCKER==='1'&&host==='host.docker.internal'))throw new Error('Only local Langflow permitted');
 const gateway=new SupabaseGateway(config.supabase),auth=new AuthService(gateway);
 const membership=await gateway.call<Membership>('profile.get',{user_id:userId});
 const principal:Principal={userId,sessionId:authSessionId,expiresAt,token:'',membership};auth.active(principal);
 const client=new McpHttpClient({url:server.url,headers:Object.fromEntries((server.headers||[]).map((h:any)=>[h.name,h.value]))});
 const samples:any[]=[];
 try{
  await client.initialize();const tools=await client.listTools();
  const invoke=async(name:'prepare_needs'|'fetch_shelters')=>{
   const tool=tools.find(t=>canonicalToolName(t.name)===name);if(!tool)throw new Error('Required tool missing');
   const start=Date.now();await auth.stillAuthorized(userId,authSessionId,contextId);const authorized=Date.now();
   const input=name==='prepare_needs'?'Laporan sintetis pengukuran: Posko Uji Antrean di Desa Uji, 10 jiwa, laki-laki 4, perempuan 6. Stok air 200 liter untuk 24 jam.':{action:'all'};
   const raw=await client.callTool(tool.name,{input_value:JSON.stringify({__sigap_context:auth.capability(principal,contextId,name),input:typeof input==='string'?input:JSON.stringify(input)})},AbortSignal.timeout(90000));
   const text=raw.content.filter(p=>p.type==='text').map(p=>p.text||'').join('\n');
   if(raw.isError)throw new Error('Workflow failed');
   const count=name==='fetch_shelters'?parseSigapReadResult(text).records?.length:undefined;
   if(name==='prepare_needs'&&!text.includes('<<<SOURCE_REF>>>'))throw new Error('No source reference');
   return {tool:name,start:new Date(start).toISOString(),authorization_ms:authorized-start,mcp_ms:Date.now()-authorized,total_ms:Date.now()-start,content_parts:raw.content.length,response_bytes:Buffer.byteLength(text),...(count===undefined?{}:{stored_records:count})};
  };
  for(const mode of ['parallel','sequential','parallel','sequential']){
   const start=Date.now();let results;
   if(mode==='parallel')results=await Promise.all([invoke('prepare_needs'),invoke('fetch_shelters')]);
   else results=[await invoke('prepare_needs'),await invoke('fetch_shelters')];
   samples.push({mode,total_ms:Date.now()-start,results});
   console.error(JSON.stringify({completed_mode:mode,total_ms:samples.at(-1).total_ms}));
  }
  console.log(JSON.stringify({operational_write:false,model_call:false,transport:process.env.SIGAP_DOCKER==='1'?'docker_to_host':'native',samples},null,2));
 }finally{await client.close();}
}
main().catch(error=>{console.error(JSON.stringify({measurement_failed:true,error_name:error?.name,message:typeof error?.message==='string'&&/^(MCP |SIGAP_|Required tool|No source|Workflow failed)/.test(error.message)?error.message:'Workflow response could not be verified'}));process.exitCode=1;});
