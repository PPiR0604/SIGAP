/** Upgrade all seven local MCP flows, preserving graph IDs and existing model credentials. */
import '../src/config.js';
import {loadAgentSessionConfig} from '../src/acp/sessionConfig.js';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const apply=process.argv.includes('--apply');
const server=loadAgentSessionConfig('gemini').mcpServerConfig.find((s:any)=>s.name==='langflow');
if(!['localhost','127.0.0.1'].includes(new URL(server.url).hostname))throw new Error('Only the configured local Langflow may be upgraded.');
const headers={...Object.fromEntries(server.headers.map((h:any)=>[h.name,h.value])),'Content-Type':'application/json'};
const response=await fetch(new URL('/api/v1/flows/?get_all=true',server.url),{headers,redirect:'error'});if(!response.ok)throw new Error('Cannot inspect local flows.');
const data:any=await response.json(),flows=Array.isArray(data)?data:data.flows,project=/\/project\/([^/]+)/.exec(server.url)?.[1];
const directory=resolve('../output/auth-migration/rollback-'+new Date().toISOString().replace(/[:.]/g,'-'));const patches:any[]=[];
for(const endpoint of ['prepare_needs','validate_needs','fetch_shelters','flag_anomalies','calculate_gap','upsert_shelter','draft_bulletin']){
 const matches=flows.filter((f:any)=>f.endpoint_name===endpoint&&(!project||f.folder_id===project));if(matches.length!==1)throw new Error('Missing/ambiguous flow '+endpoint);
 const flow=structuredClone(matches[0]),source=JSON.parse(readFileSync(resolve('../langflow/flows/supabase/'+endpoint+'.json'),'utf8'));
 const chat=flow.data.nodes.find((n:any)=>n.data.node.display_name==='Chat Input');if(!chat)throw new Error('Missing Chat Input');
 const handle=flow.data.edges.find((e:any)=>e.source===chat.id)?.sourceHandle;if(!handle)throw new Error('Missing Chat Input edge');
 let patched=0;
 for(const node of flow.data.nodes){const config=node.data.node,secure=source.data.nodes.find((n:any)=>n.data.node.display_name===config.display_name)?.data.node;
  if(!secure?.template?.sigap_context)continue;
  config.template.code.value=secure.template.code.value;config.template.sigap_context=secure.template.sigap_context;
  config.field_order=[...new Set([...(config.field_order??[]),'sigap_context'])];
  // Only the authenticated transport may choose storage. No fallback write to Sheets or CSV.
  if(config.template.storage_mode)config.template.storage_mode.value='sqlite'; // Component delegates this branch to scoped Supabase adapter.
  const target={fieldName:'sigap_context',id:node.id,inputTypes:['Message'],type:'str'};
  flow.data.edges=flow.data.edges.filter((e:any)=>!(e.target===node.id&&String(e.targetHandle).includes('sigap_context')));
  flow.data.edges.push({source:chat.id,target:node.id,sourceHandle:handle,targetHandle:JSON.stringify(target).replaceAll('"','œ'),id:'sigap-auth-'+node.id,data:{sourceHandle:JSON.parse(handle.replaceAll('œ','"')),targetHandle:target}});
  patched++;
 }
 if(!patched)throw new Error('No protected component in '+endpoint);
 patches.push({original:matches[0],flow,endpoint,patched});
}
if(apply){mkdirSync(directory,{recursive:true});for(const p of patches)writeFileSync(resolve(directory,p.endpoint+'.json'),JSON.stringify(p.original),{flag:'wx'});const installed:any[]=[];
 try{for(const p of patches){const r=await fetch(new URL('/api/v1/flows/'+p.flow.id,server.url),{method:'PATCH',headers,body:JSON.stringify({data:p.flow.data}),redirect:'error'});if(!r.ok)throw new Error('Patch failed '+p.endpoint);installed.push(p);}}
 catch(error){for(const p of installed.reverse()){const r=await fetch(new URL('/api/v1/flows/'+p.original.id,server.url),{method:'PATCH',headers,body:JSON.stringify({data:p.original.data}),redirect:'error'});if(!r.ok)throw new Error('Rollback needs manual attention: '+directory);}throw error;}
}
console.log(JSON.stringify({applied:apply,flows:patches.map(p=>({endpoint:p.endpoint,protected_components:p.patched})),...(apply?{rollback:directory}:{})}));
