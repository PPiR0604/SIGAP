/** Explicit local Langflow upgrade. Preserves IDs, topology, secrets and immutable rollback copies. */
import '../src/config.js';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadAgentSessionConfig} from '../src/acp/sessionConfig.js';
const apply=process.argv.includes('--apply');
const only=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7);
if(only&&!['fetch_shelters','validate_needs','prepare_needs','upsert_shelter'].includes(only))throw new Error('Endpoint --only tidak dikenal.');
const server=loadAgentSessionConfig('gemini').mcpServerConfig.find((s:any)=>s.name==='langflow');
if(!['localhost','127.0.0.1'].includes(new URL(server.url).hostname))throw new Error('Skrip ini hanya untuk Langflow lokal.');
const headers={...Object.fromEntries(server.headers.map((h:any)=>[h.name,h.value])),'Content-Type':'application/json'};
const response=await fetch(new URL('/api/v1/flows/?get_all=true',server.url),{headers});
if(!response.ok)throw new Error('Daftar flow tidak dapat dibaca.');
const body:any=await response.json();const flows=Array.isArray(body)?body:body.flows;
const project=/\/project\/([^/]+)/.exec(server.url)?.[1];
const path=resolve('../output/rekap_posko.sqlite3').replaceAll('\\','/');
if(!existsSync(path))throw new Error('Migrasikan/cadangkan rekap ke SQLite terlebih dahulu.');
const changed:string[]=[];const changedFlows:any[]=[];
const directory=resolve('../output/testing/storage-migration/rollback');mkdirSync(directory,{recursive:true});
for(const endpoint of ['fetch_shelters','validate_needs','prepare_needs','upsert_shelter']){
  if(only&&endpoint!==only)continue;
  const matches=flows.filter((f:any)=>f.endpoint_name===endpoint&&(!project||f.folder_id===project));
  if(matches.length!==1)throw new Error(`Flow ${endpoint} hilang atau ambigu.`);
  const flow=matches[0];
  const backup=resolve(directory,`${endpoint}.json`);
  if(!existsSync(backup))writeFileSync(backup,JSON.stringify(flow),{flag:'wx'});
  const exported=JSON.parse(readFileSync(resolve(`../langflow/flows/${endpoint}.json`),'utf8'));
  let patched=false;
  for(const node of flow.data.nodes){
    const config=node.data.node;
    const source=exported.data.nodes.find((n:any)=>n.data.node.display_name===config.display_name)?.data.node;
    if(!source?.template?.sqlite_path&&config.display_name!=='Officer Confirmation Gate')continue;
    if(!source?.template?.code?.value)continue;
    config.template.code.value=source.template.code.value;
    if(source.template.sqlite_path){
      config.template.sqlite_path={...source.template.sqlite_path,value:path};
      config.field_order=[...new Set([...(config.field_order||[]),'sqlite_path'])];
    }
    if(config.template.storage_mode){config.template.storage_mode.options=['sqlite','auto','google_sheets','csv'];config.template.storage_mode.value='sqlite';}
    patched=true;
  }
  if(!patched)continue; // Live prepare flow may delegate validation to the standalone validator.
  changed.push(endpoint);changedFlows.push(flow);
}
if(apply){
  const installed:any[]=[];
  try{
    // Writer switches first; reader last. Stop user sessions during this maintenance window.
    for(const flow of [...changedFlows].sort((a,b)=>Number(a.endpoint_name==='fetch_shelters')-Number(b.endpoint_name==='fetch_shelters'))){
      const result=await fetch(new URL(`/api/v1/flows/${flow.id}`,server.url),{method:'PATCH',headers,body:JSON.stringify({data:flow.data})});
      if(!result.ok)throw new Error(`Pembaruan flow ${flow.endpoint_name} gagal (${result.status}).`);
      installed.push(flow);
    }
  }catch(error){
    for(const flow of installed.reverse()){
      const old=JSON.parse(readFileSync(resolve(directory,`${flow.endpoint_name}.json`),'utf8'));
      const restored=await fetch(new URL(`/api/v1/flows/${flow.id}`,server.url),{method:'PATCH',headers,body:JSON.stringify({data:old.data})});
      if(!restored.ok)throw new Error('Pembaruan gagal dan rollback perlu diperiksa. Backup tetap tersedia.');
    }
    throw error;
  }
}
writeFileSync(resolve('../output/testing/storage-migration/deployment.json'),JSON.stringify({applied:apply,flows:changed,database:path,source_preserved:true},null,2));
console.log(JSON.stringify({applied:apply,flows:changed,database:path,source_preserved:true}));
