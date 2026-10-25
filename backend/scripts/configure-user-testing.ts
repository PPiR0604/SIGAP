/** Explicit local maintenance: switch all storage owners together; preserve exact rollback files. */
import '../src/config.js';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {loadAgentSessionConfig} from '../src/acp/sessionConfig.js';
import {McpHttpClient} from '../src/mcp/httpClient.js';
import {canonicalToolName} from '../src/acp/toolNames.js';
import {parseSigapReadResult} from '../src/pipeline/toolResults.js';

const option=(name:string)=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const apply=process.argv.includes('--apply');
const manifestPath=resolve(option('manifest')||'../output/user-testing/current/seed-manifest.json');
const rollback=option('rollback');
const server=loadAgentSessionConfig('openai').mcpServerConfig?.find((s:any)=>s.name==='langflow');
if(!server||!['localhost','127.0.0.1'].includes(new URL(server.url).hostname))throw new Error('Pemeliharaan hanya menerima Langflow lokal.');
const headers={...Object.fromEntries((server.headers||[]).map((h:any)=>[h.name,h.value])),'Content-Type':'application/json'};
const output=dirname(rollback?resolve(rollback):manifestPath);
const deploymentPath=resolve(output,'deployment.json');
async function patch(flow:any){
  const response=await fetch(new URL(`/api/v1/flows/${flow.id}`,server!.url),{method:'PATCH',headers,body:JSON.stringify({data:flow.data}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Patch ${flow.endpoint_name} gagal (${response.status}).`);
}
const manifest=rollback?null:JSON.parse(readFileSync(manifestPath,'utf8'));
if(rollback){
  const deployment=JSON.parse(readFileSync(resolve(rollback),'utf8'));
  const saved=deployment.backups.map((path:string)=>JSON.parse(readFileSync(path,'utf8')));
  if(apply)for(const flow of saved)await patch(flow);
  console.log(JSON.stringify({rollback:true,applied:apply,flows:saved.map((flow:any)=>flow.endpoint_name)}));
}else{
  if(manifest.synthetic!==true||manifest.applied!==true||!existsSync(manifest.database))throw new Error('Seed sintetis baru harus sudah terverifikasi sebelum mengubah flow.');
  const response=await fetch(new URL('/api/v1/flows/?get_all=true',server.url),{headers,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Daftar flow Langflow gagal dibaca.');
  const body:any=await response.json(),flows=Array.isArray(body)?body:body.flows;
  const project=/\/project\/([^/]+)/.exec(server.url)?.[1];
  const endpoints=['upsert_shelter','validate_needs','prepare_needs','fetch_shelters'];
  const backups:string[]=[],changes:any[]=[],originals:any[]=[];
  for(const endpoint of endpoints){
    const matches=flows.filter((flow:any)=>flow.endpoint_name===endpoint&&(!project||flow.folder_id===project));
    if(matches.length!==1)throw new Error(`Flow ${endpoint} hilang atau ambigu.`);
    const original=matches[0],flow=structuredClone(original);
    let nodes=0;
    for(const node of flow.data.nodes){
      const template=node.data.node.template;
      if(!template.sqlite_path)continue;
      template.sqlite_path.value=manifest.database.replaceAll('\\','/');
      if(template.storage_mode)template.storage_mode.value='sqlite';
      nodes++;
    }
    if(!nodes&&endpoint!=='prepare_needs')throw new Error(`Flow ${endpoint} belum memiliki field SQLite.`);
    if(nodes){originals.push(original);changes.push(flow);backups.push(resolve(output,`rollback-${endpoint}.json`));}
  }
  if(apply){
    if(existsSync(deploymentPath)||backups.some(path=>existsSync(path)))throw new Error('Rollback file sudah ada. Gunakan direktori seed baru untuk sesi uji berikutnya.');
    mkdirSync(output,{recursive:true});
    originals.forEach((flow,index)=>writeFileSync(backups[index],JSON.stringify(flow),{flag:'wx'}));
    const installed:any[]=[];
    try{
      // Independent Langflow execution first, with a per-run path override, before changing active flows.
      const reader=changes.find(flow=>flow.endpoint_name==='fetch_shelters');
      const tweaks=Object.fromEntries(reader.data.nodes.filter((node:any)=>node.data.node.template.sqlite_path).map((node:any)=>[node.id,{sqlite_path:manifest.database.replaceAll('\\','/'),storage_mode:'sqlite'}]));
      const preflight=await fetch(new URL(`/api/v1/run/${reader.id}?stream=false`,server.url),{method:'POST',headers,body:JSON.stringify({input_value:'{"action":"all"}',input_type:'chat',output_type:'chat',tweaks}),signal:AbortSignal.timeout(60000)});
      if(!preflight.ok)throw new Error(`Playground/run reader gagal (${preflight.status}).`);
      const texts=(value:any):string[]=>!value||typeof value!=='object'?[]:Object.entries(value).flatMap(([key,item])=>key==='text'&&typeof item==='string'?[item]:texts(item));
      const checked=parseSigapReadResult(texts(await preflight.json()).join('\n'));
      assert.equal(checked.records?.length,manifest.rows,'Reader flow harus membaca seluruh seed.');
      for(const flow of changes){await patch(flow);installed.push(flow);}
      const client=new McpHttpClient({url:server.url,headers});
      try{
        await client.initialize();
        const tool=(await client.listTools()).find(tool=>canonicalToolName(tool.name)==='fetch_shelters');
        assert.ok(tool,'Tool MCP reader harus tersedia.');
        const raw=await client.callTool(tool.name,{input_value:'{"action":"all"}'});
        const read=parseSigapReadResult(raw.content.filter(part=>part.type==='text').map(part=>part.text).join('\n'));
        assert.ok(read.records);
        assert.equal(read.records?.length,manifest.rows);
        assert.equal(read.records.reduce((sum,record)=>sum+Number(record.total_people||0),0),manifest.total_people);
        assert.ok(read.records.every(record=>String(record.notes).includes('SINTETIS')));
        writeFileSync(resolve(output,'verified-readback.json'),JSON.stringify(read,null,2));
      }finally{await client.close();}
    }catch(error){
      for(const flow of originals.filter(original=>installed.some(flow=>flow.id===original.id)).reverse())await patch(flow);
      throw error;
    }
    writeFileSync(deploymentPath,JSON.stringify({applied:true,synthetic:true,manifest:manifestPath,database:manifest.database,backups,flows:changes.map(flow=>flow.endpoint_name),previous_database_preserved:true,checked_at:new Date().toISOString()},null,2));
  }
  console.log(JSON.stringify({applied:apply,synthetic:true,database:manifest.database,rows:manifest.rows,total_people:manifest.total_people,flows:changes.map(flow=>flow.endpoint_name),rollback:apply?deploymentPath:undefined}));
}
