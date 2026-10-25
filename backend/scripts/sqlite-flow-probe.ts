/** Real Langflow flow runs with per-run SQLite path overrides. Operational rekap is never written. */
import '../src/config.js';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadAgentSessionConfig} from '../src/acp/sessionConfig.js';
import {McpHttpClient} from '../src/mcp/httpClient.js';
import {canonicalToolName} from '../src/acp/toolNames.js';
import {parsePrepareNeedsOutput,parseSigapWriteResult,parseSigapReadResult} from '../src/pipeline/toolResults.js';
const server=loadAgentSessionConfig('gemini').mcpServerConfig.find((s:any)=>s.name==='langflow');
const headers=Object.fromEntries(server.headers.map((h:any)=>[h.name,h.value]));
const client=new McpHttpClient({url:server.url,headers});
const dir=resolve('../output/testing/storage-migration/probe-'+Date.now());mkdirSync(dir,{recursive:true});
const database=resolve(dir,'test.sqlite3').replaceAll('\\','/');
const originals=JSON.parse(readFileSync('../output/testing/storage-migration/active-flows.json','utf8'));
function texts(value:any):string[]{
  if(!value||typeof value!=='object')return [];
  return Object.entries(value).flatMap(([key,item])=>key==='text'&&typeof item==='string'?[item]:texts(item));
}
async function run(endpoint:string,input:any):Promise<string>{
  const flow=originals.find((f:any)=>f.endpoint_name===endpoint);assert.ok(flow);
  const overrides=Object.fromEntries(flow.data.nodes.filter((n:any)=>['Logistics Storage Reader','Logistics Storage Writer','Shelter Report Validator'].includes(n.data.node.display_name)).map((n:any)=>[n.id,{sqlite_path:database,storage_mode:'sqlite'}]));
  const response=await fetch(new URL(`/api/v1/run/${flow.id}?stream=false`,server.url),{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({input_value:JSON.stringify(input),input_type:'chat',output_type:'chat',tweaks:overrides}),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`Flow ${endpoint} gagal (${response.status}).`);
  return texts(await response.json()).join('\n');
}
try{
  await client.initialize();const tools=await client.listTools();
  const prepare=tools.find(t=>canonicalToolName(t.name)==='prepare_needs')!;
  async function candidate(total:number,male:number,time:string){
    const source=await client.callTool(prepare.name,{input_value:`22/10/26 ${time} - Relawan: Posko Uji SQLite, Desa Uji SQLite. Total ${total} jiwa, laki-laki ${male}, perempuan 6. Butuh air bersih.`});
    const marker=/<<<SOURCE_REF>>>(.*?)<<<END_SOURCE_REF>>>/s.exec(source.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'));assert.ok(marker);
    return parsePrepareNeedsOutput(await run('validate_needs',{...JSON.parse(marker[1]),records:[{report_id:'R001',shelter_name:'Posko Uji SQLite',village:'Desa Uji SQLite',total_people:total,male,female:6,urgent_needs:['air bersih']}]}));
  }
  const initial=await candidate(10,4,'20.00');
  const approval=(p:any)=>({snapshot_id:p.snapshot_id,snapshot_sha256:p.snapshot_sha256,approved_snapshot_sha256:p.snapshot_sha256,confirmed_by_officer:true,allow_partial:true});
  assert.match(await run('upsert_shelter',{...approval(initial),confirmed_by_officer:false}),/DITOLAK/);
  const receipt=parseSigapWriteResult(await run('upsert_shelter',approval(initial)));assert.equal(receipt.status,'saved');
  const read=()=>run('fetch_shelters',{action:'all'});
  assert.equal(parseSigapReadResult(await read()).records?.length,1);
  // Regression: corrections from a stored read-back include versi in update_target.expected.
  // The writer must match against the storage header including metadata, then update once.
  const stored=parseSigapReadResult(await read());
  const correctedSource=await client.callTool(prepare.name,{input_value:JSON.stringify({report_text:'22/10/26 20.30 - Relawan: Mohon klarifikasi laporan R001 (Posko Uji SQLite): laki-laki: 3. perempuan: 7.',correction_target:{snapshot_id:stored.snapshot_id,snapshot_sha256:stored.snapshot_sha256,record_index:0}})});
  const correctedMarker=/<<<SOURCE_REF>>>(.*?)<<<END_SOURCE_REF>>>/s.exec(correctedSource.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'));assert.ok(correctedMarker);
  const corrected=parsePrepareNeedsOutput(await run('validate_needs',{...JSON.parse(correctedMarker[1]),records:[{report_id:'R001',shelter_name:'Posko Uji SQLite',male:3,female:7}]}));
  writeFileSync(resolve(dir,'targeted-preview.json'),JSON.stringify({stored,corrected,source:correctedSource},null,2));
  assert.ok('versi' in (corrected.snapshot_records[0].update_target as any)?.expected);
  const correctedReceipt=parseSigapWriteResult(await run('upsert_shelter',{...approval(corrected),conflict_decisions:{R001:Object.fromEntries((corrected.snapshot_records[0].storage_conflicts||[]).map((c:any)=>[c.field,'incoming']))}}));
  assert.equal(correctedReceipt.status,'saved');
  const correctedRead=parseSigapReadResult(await run('fetch_shelters',{action:'all',expected_snapshot_id:correctedReceipt.snapshot_id,expected_snapshot_sha256:correctedReceipt.snapshot_sha256}));
  writeFileSync(resolve(dir,'targeted-readback.json'),JSON.stringify(correctedRead,null,2));
  assert.equal(correctedRead.verification?.status||correctedRead.verification_status,'verified');
  assert.equal(correctedRead.records?.length,1);assert.equal(correctedRead.records?.[0].male,3);
  const next=await candidate(12,6,'21.00');
  const conflicts=next.snapshot_records[0].storage_conflicts||[];assert.ok(conflicts.some((c:any)=>c.field==='total_people'));
  assert.match(await run('upsert_shelter',approval(next)),/DITOLAK/);
  const kept=parseSigapWriteResult(await run('upsert_shelter',{...approval(next),conflict_decisions:{R001:Object.fromEntries(conflicts.map((c:any)=>[c.field,'keep']))}}));
  assert.equal(kept.status,'saved');
  const checked=parseSigapReadResult(await run('fetch_shelters',{action:'all',expected_snapshot_id:kept.snapshot_id,expected_snapshot_sha256:kept.snapshot_sha256}));
  assert.equal(checked.verification?.status||checked.verification_status,'verified');assert.equal(checked.records?.[0].total_people,10);
  const incoming=await candidate(14,8,'22.00');
  const incomingChoices={R001:Object.fromEntries((incoming.snapshot_records[0].storage_conflicts||[]).map((c:any)=>[c.field,'incoming']))};
  const added=parseSigapWriteResult(await run('upsert_shelter',{...approval(incoming),conflict_decisions:incomingChoices}));assert.equal(added.status,'saved');
  assert.equal(parseSigapReadResult(await read()).records?.[0].total_people,14);
  const first=await candidate(16,10,'23.00'),stale=await candidate(18,12,'23.10');
  const chooseIncoming=(p:any)=>({...approval(p),conflict_decisions:{R001:Object.fromEntries((p.snapshot_records[0].storage_conflicts||[]).map((c:any)=>[c.field,'incoming']))}});
  assert.equal(parseSigapWriteResult(await run('upsert_shelter',chooseIncoming(first))).status,'saved');
  assert.match(await run('upsert_shelter',chooseIncoming(stale)),/GAGAL.*berubah/s);
  const final=parseSigapReadResult(await read());assert.equal(final.records?.length,1);assert.equal(final.records?.[0].total_people,16);
  const summary={real_langflow:true,operational_write:false,test_database:database,targeted_version_update:'verified',conflicts:conflicts.length,kept_total:10,incoming_total:14,stale_rejected:true,readback:'verified',checked_at:new Date().toISOString()};
  writeFileSync(resolve(dir,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{await client.close();}
