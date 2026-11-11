// Isolate Langflow preparation from first-turn rekap loading and model extraction.
// Creates synthetic immutable source metadata; never approves/saves shelter data.
import '../src/config.js';
import {loadConfig} from '../src/config.js';
import {loadAgentSessionConfig} from '../src/acp/sessionConfig.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {AuthService,type Membership,type Principal} from '../src/auth/service.js';
import {McpHttpClient} from '../src/mcp/httpClient.js';
import {canonicalToolName} from '../src/acp/toolNames.js';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const [userId,authSessionId,contextId,expiry]=process.argv.slice(2);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const expiresAt=Number(expiry);
if(!uuid.test(userId||'')||!uuid.test(authSessionId||'')||!contextId||!Number.isFinite(expiresAt)||expiresAt<Date.now()+60000)
  throw new Error('Usage: tsx scripts/measure-preparation-latency.ts USER_ID AUTH_SESSION_ID CONTEXT_ID TOKEN_EXPIRY_MS');
const settings=loadConfig().supabase;
if(!settings)throw new Error('Supabase is not configured.');
const server=loadAgentSessionConfig('gemini').mcpServerConfig?.find((s:any)=>s.name==='langflow'&&s.type==='http');
if(!server||!['localhost','127.0.0.1'].includes(new URL(server.url).hostname))throw new Error('Only configured local Langflow is permitted.');
const gateway=new SupabaseGateway(settings),auth=new AuthService(gateway);
const membership=await gateway.call<Membership>('profile.get',{user_id:userId});
const principal:Principal={userId,sessionId:authSessionId,expiresAt,token:'',membership};
auth.active(principal);
const client=new McpHttpClient({url:server.url,headers:Object.fromEntries((server.headers??[]).map((h:any)=>[h.name,h.value]))});
const signal=AbortSignal.timeout(90000),samples=[];
let originalFlow:any,patchAttempted=false,profilePath:string|undefined;
const apiHeaders={...Object.fromEntries((server.headers??[]).map((h:any)=>[h.name,h.value])),'Content-Type':'application/json'};
try{
  if(process.argv.includes('--profile-execution')){
    await auth.stillAuthorized(userId,authSessionId,contextId);
    const response=await fetch(new URL('/api/v1/flows/?get_all=true',server.url),{headers:apiHeaders,redirect:'error'});
    if(!response.ok)throw new Error('Cannot inspect local profiling flow.');
    const body:any=await response.json(),project=/\/project\/([^/]+)/.exec(server.url)?.[1];
    const matches=(Array.isArray(body)?body:body.flows).filter((f:any)=>f.endpoint_name==='prepare_needs'&&(!project||f.folder_id===project));
    if(matches.length!==1)throw new Error('Missing or ambiguous preparation flow.');
    originalFlow=matches[0];
    const flow=structuredClone(originalFlow),node=flow.data.nodes.find((n:any)=>n.data.node.display_name==='Posko Report Preprocessor');
    const code=node?.data.node.template.code;
    const marker='    def build_clean_reports(self) -> Message:\n';
    if(!code?.value.includes(marker))throw new Error('Unsupported preparation component.');
    const stamp=Date.now();mkdirSync(resolve('../output/testing'),{recursive:true});
    writeFileSync(resolve('../output/testing/langflow-profile-rollback-'+stamp+'.json'),JSON.stringify(originalFlow),{flag:'wx'});
    profilePath=resolve('../output/testing/langflow-execution-profile-'+stamp+'.jsonl');
    const instrumentation=readFileSync(resolve('scripts/langflow-execution-profile.py'),'utf8').replace('__SIGAP_PROFILE_PATH__',JSON.stringify(profilePath.replaceAll('\\','/')));
    code.value=instrumentation+'\n'+code.value.replace(marker,marker+'        _sigap_install_profile(self)\n');
    patchAttempted=true;
    const patched=await fetch(new URL('/api/v1/flows/'+flow.id,server.url),{method:'PATCH',headers:apiHeaders,body:JSON.stringify({data:flow.data}),redirect:'error'});
    if(!patched.ok)throw new Error('Cannot install temporary profiling instrumentation.');
  }
  const setup=performance.now();
  await client.initialize(signal);
  const tool=(await client.listTools(signal)).find(t=>canonicalToolName(t.name)==='prepare_needs');
  if(!tool)throw new Error('Preparation tool is unavailable.');
  const setupMs=Math.round(performance.now()-setup);
  for(let i=0;i<2;i++){
    const started=performance.now();
    await auth.stillAuthorized(userId,authSessionId,contextId);
    const authorized=performance.now();
    const input='Laporan sintetis pengukuran: Posko Uji Persiapan di Desa Uji, 10 jiwa, laki-laki 4, perempuan 6. Stok air 200 liter untuk 24 jam.';
    const result=await client.callTool(tool.name,{input_value:JSON.stringify({__sigap_context:auth.capability(principal,contextId,'prepare_needs'),input})},signal);
    const text=result.content.filter(p=>p.type==='text').map(p=>p.text||'').join('\n');
    if(result.isError||!text.includes('<<<SOURCE_REF>>>')||!text.includes('[R001]'))throw new Error('Preparation did not return a verifiable source.');
    const first=result.content.find(p=>p.type==='text'&&p.text?.includes('<<<SOURCE_REF>>>'))?.text||'';
    const normalized=first.replace(/<<<SOURCE_REF>>>[\s\S]*?<<<END_SOURCE_REF>>>/g,'<<<SOURCE_REF>>>REFERENCE<<<END_SOURCE_REF>>>');
    samples.push({authorization_ms:Math.round(authorized-started),mcp_preparation_ms:Math.round(performance.now()-authorized),total_ms:Math.round(performance.now()-started),response_bytes:Buffer.byteLength(text),normalized_prompt_sha256:createHash('sha256').update(normalized).digest('hex'),parts:result.content.filter(p=>p.type==='text').map(p=>{const t=p.text||'';let parsed:any,ref:any;try{parsed=JSON.parse(t);}catch{}const marker=/<<<SOURCE_REF>>>(.*?)<<<END_SOURCE_REF>>>/s.exec(t);try{if(marker)ref=JSON.parse(marker[1]);}catch{}const body=marker?t.slice(marker.index!+marker[0].length).trim():'';return {bytes:Buffer.byteLength(t),same_as_first:t===first,trimmed_same:t.trim()===first.trim(),json_type:typeof parsed,json_keys:parsed&&typeof parsed==='object'?Object.keys(parsed).slice(0,12):null,valid_reference:typeof ref?.batch_id==='string'&&typeof ref?.source_sha256==='string',body_bytes:Buffer.byteLength(body),body_sha256:createHash('sha256').update(body).digest('hex'),report_headers:[...body.matchAll(/^\[(R\d+)\]/gm)].map(m=>m[1])};})});
  }
  console.log(JSON.stringify({synthetic:true,operational_write:false,direct_model_call:false,setup_ms:setupMs,samples,
    ...(profilePath?{profile:readFileSync(profilePath,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))}:{})},null,2));
}finally{
  await client.close();
  if(patchAttempted){
    const restored=await fetch(new URL('/api/v1/flows/'+originalFlow.id,server.url),{method:'PATCH',headers:apiHeaders,body:JSON.stringify({data:originalFlow.data}),redirect:'error'});
    if(!restored.ok)throw new Error('Profiling rollback failed; restore the original flow from output/testing before continuing.');
    console.log(JSON.stringify({profiling_flow_restored:true}));
  }
}
