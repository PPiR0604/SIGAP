/** Read/preview-only Langflow regression; optional code-only deployment preserves every storage path. */
import '../src/config.js';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadAgentSessionConfig} from '../src/acp/sessionConfig.js';
import {McpHttpClient} from '../src/mcp/httpClient.js';
import {canonicalToolName} from '../src/acp/toolNames.js';
import {parseSigapReadResult,parsePrepareNeedsOutput} from '../src/pipeline/toolResults.js';

const apply=process.argv.includes('--apply');
const server=loadAgentSessionConfig('openai').mcpServerConfig.find((s:any)=>s.name==='langflow');
if(!server||!['localhost','127.0.0.1'].includes(new URL(server.url).hostname))throw new Error('Probe hanya untuk Langflow lokal.');
const headers={...Object.fromEntries(server.headers.map((h:any)=>[h.name,h.value])),'Content-Type':'application/json'};
const response=await fetch(new URL('/api/v1/flows/?get_all=true',server.url),{headers});
if(!response.ok)throw new Error('Daftar flow gagal dibaca.');
const body:any=await response.json(),flows=Array.isArray(body)?body:body.flows;
const project=/\/project\/([^/]+)/.exec(server.url)?.[1];
const matches=flows.filter((f:any)=>f.endpoint_name==='validate_needs'&&(!project||f.folder_id===project));assert.equal(matches.length,1);
const original=matches[0],updated=structuredClone(original);
const exported=JSON.parse(readFileSync(resolve('../langflow/flows/validate_needs.json'),'utf8'));
const code=exported.data.nodes.find((n:any)=>n.data.node.display_name==='Shelter Report Validator').data.node.template.code.value;
const nodes=updated.data.nodes.filter((n:any)=>n.data.node.display_name==='Shelter Report Validator');assert.equal(nodes.length,1);
nodes[0].data.node.template.code.value=code;
const client=new McpHttpClient({url:server.url,headers});
const directory=resolve('../output/testing/edit-ui-audit/validator-'+Date.now());mkdirSync(directory,{recursive:true});
const text=(result:any)=>result.content.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('\n');
const texts=(value:any):string[]=>!value||typeof value!=='object'?[]:Object.entries(value).flatMap(([key,item])=>key==='text'&&typeof item==='string'?[item]:texts(item));
async function patch(flow:any){const r=await fetch(new URL(`/api/v1/flows/${flow.id}`,server.url),{method:'PATCH',headers,body:JSON.stringify({data:flow.data})});if(!r.ok)throw new Error(`Patch flow gagal (${r.status}).`);}
let installed=false;
if(!apply){
  console.log(JSON.stringify({applied:false,flow:original.endpoint_name,code_only:true,storage_path_preserved:true,external_write:false}));
  process.exit(0);
}
try{
  await client.initialize();const tools=await client.listTools();
  const tool=(name:string)=>{const found=tools.find(t=>canonicalToolName(t.name)===name);assert.ok(found);return found.name;};
  const stored=parseSigapReadResult(text(await client.callTool(tool('fetch_shelters'),{input_value:'{"action":"all"}'})));
  const index=stored.records!.findIndex(r=>r.shelter_name==='Posko Cibening'&&r.village==='Cibineng');assert.ok(index>=0);
  const old=stored.records![index],newName='Posko Cibening Utama';
  const prepared=text(await client.callTool(tool('prepare_needs'),{input_value:JSON.stringify({report_text:`Mohon klarifikasi laporan ${old.report_id} (${old.shelter_name}): Koreksi nama posko ini menjadi ${newName}. Desa tetap Cibineng. Semua angka dan kebutuhan tetap sama.`,correction_target:{snapshot_id:stored.snapshot_id,snapshot_sha256:stored.snapshot_sha256,record_index:index}})}));
  const marker=/<<<SOURCE_REF>>>(.*?)<<<END_SOURCE_REF>>>/s.exec(prepared);assert.ok(marker);
  const request={...JSON.parse(marker[1]),records:[{report_id:'R001',shelter_name:newName,village:'Cibineng'}]};
  writeFileSync(resolve(directory,'rollback-validate-needs.json'),JSON.stringify(original),{flag:'wx'});
  await patch(updated);installed=true;
  // Run the flow independently before testing it through MCP. API run disallows code tweaks.
  const run=await fetch(new URL(`/api/v1/run/${original.id}?stream=false`,server.url),{method:'POST',headers,body:JSON.stringify({input_value:JSON.stringify(request),input_type:'chat',output_type:'chat'}),signal:AbortSignal.timeout(60000)});
  if(!run.ok)throw new Error(`Flow independen gagal (${run.status}).`);
  const preflight=parsePrepareNeedsOutput(texts(await run.json()).join('\n'));
  assert.equal(preflight.snapshot_records[0].shelter_name,newName);
  assert.equal(preflight.snapshot_records[0].total_people,old.total_people);
  assert.equal((preflight.snapshot_records[0].update_target as any).shelter_name,old.shelter_name);
  if(apply){
    const checked=parsePrepareNeedsOutput(text(await client.callTool(tool('validate_needs'),{input_value:JSON.stringify(request)})));
    assert.equal(checked.snapshot_records[0].shelter_name,newName);
    assert.deepEqual(checked.snapshot_records[0].urgent_needs,old.urgent_needs);
  }
  const readback=parseSigapReadResult(text(await client.callTool(tool('fetch_shelters'),{input_value:'{"action":"all"}'})));
  assert.deepEqual(readback.records,stored.records,'Probe tidak boleh mengubah rekap.');
  const summary={applied:apply,independent_flow:'passed',mcp_validation:apply?'passed':'not_applied',storage_path_preserved:true,records_preserved:stored.records!.length,external_write:false};
  writeFileSync(resolve(directory,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}catch(error){if(installed)await patch(original);throw error;}finally{await client.close();}
