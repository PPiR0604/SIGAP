import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {scenarioMcp,scriptedModel,id,sha} from './helpers/geminiScenario.js';
import {StructuredCorrectionSchema,structuredCorrection,correctionBaseKey} from '../src/pipeline/structuredCorrection.js';
import {splitRowSnapshots,snapshotHash} from '../src/pipeline/rowDrafts.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {compactToolResult} from '../src/gemini/context.js';
import {storageRecords} from '../src/pipeline/storageDocument.js';
import {parseExtraction} from '../src/gemini/extraction.js';
import {extractionPrompt} from '../src/gemini/extractionPrompt.js';

test('extraction rejects malformed, duplicate, foreign, oversized, nonfinite and privileged data',()=>{
 const ids=new Set(['R001']);
 for(const content of ['not json','null','{"records":[]}','{"records":[null]}','{"records":[{"report_id":"R001"},{"report_id":"R001"}]}','{"records":[{"report_id":"R999"}]}','{"records":[{"report_id":"R001","total_people":1e999}]}','{"records":[{"report_id":"R001","confirmed_by_officer":true}]}','{"records":[{"report_id":"R001","field_provenance":{}}]}'])assert.throws(()=>parseExtraction(content,ids,10000));
 assert.throws(()=>parseExtraction('{"records":[]}',ids,1),/terlalu besar/);
 const records=parseExtraction('```json\n{"records":[{"report_id":"R001","disability":0,"male":null}]}\n```',ids,10000);
 assert.equal(records[0].disability,0);assert.equal(records[0].male,null);
});

test('fast report prepares and validates with exactly one model extraction and no write',async()=>{
 const report='[R001] waktu=tidak diketahui | pelapor=-\nPosko Uji 10 jiwa';
 const raw='TEMPLATE-ONLY: '+extractionPrompt+'\n[R999] template example\n<<<SOURCE_REF>>>{"batch_id":"source","source_sha256":"hash"}<<<END_SOURCE_REF>>>\n\n'+report;
 const mcp=await scenarioMcp(name=>name==='sigap_1_prepare_needs'?{content:[{type:'text',text:raw.replace(/\n\n/g,'\n').replace(/\n/g,'\n\n')},{type:'text',text:raw}]}:undefined);
 const script=scriptedModel([{role:'model',parts:[{text:JSON.stringify({records:[{report_id:'R001',shelter_name:'Posko Uji',total_people:10}]})}]}]);
 const runtime=new GeminiAgentRuntime({apiKey:'test-key',model:'test'},script.model);
 try{
  await runtime.initSession({sessionId:'fast',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
  const events:any[]=[];
  await runtime.sendPrompt({sessionId:'fast',batchId:'batch',requestId:'request',prompt:'',operation:'prepare',filteredText:'Posko Uji 10 jiwa',fastExtraction:true},e=>{events.push(e);},async()=>({allow:true}));
  assert.equal(script.inputs.length,1);assert.deepEqual(script.inputs[0].tools,[]);
  assert.deepEqual(script.inputs[0].contents,[{role:'user',parts:[{text:report}]}]);
  const calls=mcp.requests.filter(r=>r.method==='tools/call');
  assert.deepEqual(calls.map(r=>r.params.name),['sigap_1_prepare_needs','sigap_2_validate_needs']);
  assert.deepEqual(JSON.parse(calls[1].params.arguments.input_value),{batch_id:'source',source_sha256:'hash',records:[{report_id:'R001',shelter_name:'Posko Uji',total_people:10}]});
  assert.equal(events.filter(e=>e.event_type==='preview_ready').length,1);
  await runtime.sendPrompt({sessionId:'fast',batchId:'followup',requestId:'next',operation:'prepare',prompt:'Berapa jiwa di kandidat tadi?'},()=>{},async()=>({allow:true}));
  const context=JSON.stringify(script.inputs[1].contents);
  assert.match(context,/Posko Uji/);assert.match(context,/Belum disimpan/);assert.match(context,new RegExp(id));
 }finally{await runtime.shutdown();await mcp.close();}
});

test('conflicting preparation outputs stop before extraction or validation',async()=>{
 const raw='<<<SOURCE_REF>>>{"batch_id":"source","source_sha256":"hash"}<<<END_SOURCE_REF>>>\n\n[R001] Posko Uji 10 jiwa';
 const mcp=await scenarioMcp(name=>name==='sigap_1_prepare_needs'?{content:[{type:'text',text:raw},{type:'text',text:raw.replace('10 jiwa','20 jiwa')}]}:undefined);
 const script=scriptedModel([]),runtime=new GeminiAgentRuntime({apiKey:'test-key',model:'test'},script.model);
 try{
  await runtime.initSession({sessionId:'ambiguous',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
  await assert.rejects(runtime.sendPrompt({sessionId:'ambiguous',batchId:'batch',requestId:'request',operation:'prepare',prompt:'',filteredText:'Posko Uji 10 jiwa',fastExtraction:true},()=>{},async()=>({allow:true})),/Keluaran sumber Langflow berbeda/);
  assert.equal(script.inputs.length,0);
  assert.deepEqual(mcp.requests.filter(r=>r.method==='tools/call').map(r=>r.params.name),['sigap_1_prepare_needs']);
 }finally{await runtime.shutdown();await mcp.close();}
});

test('report IDs in template instructions cannot substitute for missing source reports',async()=>{
 const mcp=await scenarioMcp(name=>name==='sigap_1_prepare_needs'?{content:[{type:'text',text:'[R001] template example\n<<<SOURCE_REF>>>{"batch_id":"source","source_sha256":"hash"}<<<END_SOURCE_REF>>>\n\nTidak ada header laporan.'}]}:undefined);
 const script=scriptedModel([]),runtime=new GeminiAgentRuntime({apiKey:'test-key',model:'test'},script.model);
 try{
  await runtime.initSession({sessionId:'template-id',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
  await assert.rejects(runtime.sendPrompt({sessionId:'template-id',batchId:'batch',requestId:'request',prompt:'',operation:'prepare',filteredText:'Posko Uji 10 jiwa',fastExtraction:true},()=>{},async()=>({allow:true})),/ID sumber/);
  assert.equal(script.inputs.length,0);
  assert.deepEqual(mcp.requests.filter(r=>r.method==='tools/call').map(r=>r.params.name),['sigap_1_prepare_needs']);
 }finally{await runtime.shutdown();await mcp.close();}
});

test('omitted names use only a unique explicit name from the matching source report',()=>{
 const parse=(records:unknown[],source:string)=>parseExtraction(JSON.stringify({records}),new Set(['R001','R002']),10000,source);
 const source='[R001] waktu=tidak diketahui | pelapor=-\nLaporan uji: Posko Uji Latensi Klasifikasi di Desa Uji Latensi. Total 10 jiwa.\n[R002] waktu=tidak diketahui | pelapor=-\nPosko Mawar, Desa Sukamaju. Total 20 jiwa.';
 const result=parse([{report_id:'R001',total_people:10},{report_id:'R002',shelter_name:null,total_people:20}],source);
 assert.equal(result[0].shelter_name,'Posko Uji Latensi Klasifikasi');
 assert.equal(result[1].shelter_name,'Posko Mawar');
 assert.equal(parse([{report_id:'R001',shelter_name:'Uji Latensi Klasifikasi'}],source)[0].shelter_name,'Posko Uji Latensi Klasifikasi');
 assert.equal(parse([{report_id:'R001',shelter_name:'Mawar'}],source)[0].shelter_name,'Mawar','A name from another source report must not be substituted');
 assert.equal(parse([{report_id:'R001',shelter_name:'Harapan'}],'[R001] waktu=-\nPosko Harapan di Desa A dan Posko Mawar di Desa B.')[0].shelter_name,'Harapan','Ambiguous source names are never inferred');
 assert.equal(parse([{report_id:'R001',shelter_name:'Nama dari model'}],source)[0].shelter_name,'Nama dari model');
 assert.equal(parse([{report_id:'R001'}],'[R001] waktu=-\nTotal 10 jiwa, nama belum diketahui.')[0].shelter_name,undefined);
 assert.equal(parse([{report_id:'R001'}],'[R001] waktu=-\nPosko A, 10 jiwa. Posko B, 20 jiwa.')[0].shelter_name,undefined);
 assert.equal(parse([{report_id:'R001'}],'[R002] waktu=-\nPosko Lain, 20 jiwa.')[0].shelter_name,undefined);
});

test('fast extraction rejects invented report IDs before validation',async()=>{
 const mcp=await scenarioMcp(name=>name==='sigap_1_prepare_needs'?{content:[{type:'text',text:'<<<SOURCE_REF>>>{"batch_id":"source","source_sha256":"hash"}<<<END_SOURCE_REF>>>\n[R001] laporan'}]}:undefined);
 const script=scriptedModel([{role:'model',parts:[{text:'{"records":[{"report_id":"R999"}]}'}]}]);
 const runtime=new GeminiAgentRuntime({apiKey:'test-key',model:'test'},script.model);
 try{
  await runtime.initSession({sessionId:'fast',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
  await assert.rejects(runtime.sendPrompt({sessionId:'fast',batchId:'batch',requestId:'request',prompt:'',operation:'prepare',filteredText:'laporan',fastExtraction:true},()=>{},async()=>({allow:true})),/ID laporan/);
  assert.equal(mcp.requests.filter(r=>r.method==='tools/call').length,1);
 }finally{await runtime.shutdown();await mcp.close();}
});

test('failed fast extraction releases the session, and permission denial prevents model use',async()=>{
 const mcp=await scenarioMcp(name=>name==='sigap_1_prepare_needs'?{content:[{type:'text',text:'<<<SOURCE_REF>>>{"batch_id":"source","source_sha256":"hash"}<<<END_SOURCE_REF>>>\n[R001] Posko Uji 10 jiwa'}]}:undefined);
 const script=scriptedModel([{role:'model',parts:[{text:'malformed'}]},{role:'model',parts:[{text:'{"records":[{"report_id":"R001","shelter_name":"Posko Uji","total_people":10}]}'}]}]);
 const runtime=new GeminiAgentRuntime({apiKey:'test-key',model:'test'},script.model);
 const options={sessionId:'retry',batchId:'batch',requestId:'request',prompt:'',operation:'prepare' as const,filteredText:'Posko Uji 10 jiwa',fastExtraction:true};
 try{
  await runtime.initSession({sessionId:'retry',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
  await assert.rejects(runtime.sendPrompt(options,()=>{},async()=>({allow:false,reason:'Denied'})),/Denied/);
  assert.equal(script.inputs.length,0);assert.equal(mcp.requests.filter(r=>r.method==='tools/call').length,0);
  await assert.rejects(runtime.sendPrompt(options,()=>{},async()=>({allow:true})),/JSON valid/);
  const events:any[]=[];
  await runtime.sendPrompt({...options,batchId:'next'},event=>{events.push(event);},async()=>({allow:true}));
  assert.equal(events.filter(e=>e.event_type==='preview_ready').length,1);
  assert.equal(script.inputs.length,2);
  assert.equal(JSON.stringify(script.inputs[1].contents).includes('malformed'),false);
 }finally{await runtime.shutdown();await mcp.close();}
});

test('form source and extraction agree; unknown fields, negatives and role injection are rejected',()=>{
 const input={target:{report_id:'R002',batch_id:'source-a',name:'Posko Harapan',village:'Sukamaju'},base_key:'key',changes:{elderly:14,disability:0}};
 const parsed=StructuredCorrectionSchema.parse(input),result=structuredCorrection(parsed);
 assert.deepEqual(result.record,{shelter_name:'Posko Harapan',elderly:14,disability:0});
 assert.match(result.text,/lansia: 14/);assert.match(result.text,/disabilitas: 0/);
 for(const changes of [{elderly:-1},{role:'admin'},{needs:[]},{}])assert.equal(StructuredCorrectionSchema.safeParse({...input,changes}).success,false);
 assert.equal(correctionBaseKey({elderly:12,stock:{a:1,b:2}}),correctionBaseKey({stock:{b:2,a:1},elderly:12}));
 assert.notEqual(correctionBaseKey({elderly:12}),correctionBaseKey({elderly:14}));
});

test('recovery preserves unknown estimates and matches Langflow timestamp normalization',()=>{
 const rows=storageRecords({header:['waktu_laporan','estimasi','jumlah_jiwa','stok_json'],rows:[['2026-10-25 8:10:02','',0,'{}'],['2026-10-25T08:10:02Z','false','','{"air_liter_per_hari":0}']]});
 assert.equal(rows[0].reported_at,'2026-10-25T08:10');assert.equal(rows[0].is_estimate,null);assert.equal(rows[0].total_people,0);
 assert.equal(rows[1].reported_at,'2026-10-25T08:10+00:00');assert.equal(rows[1].is_estimate,false);assert.equal(rows[1].total_people,null);assert.equal(rows[1].stock.air_liter_per_hari,0);
});

test('model summary removes large provenance while retaining zero stock, unknowns and snapshot reference',()=>{
 const record={report_id:'R001',shelter_name:'A',stock:{air_liter_per_hari:0},stock_context:{air_liter_per_hari:{horizon_hours:24,unit:'L'}},male:null,total_people:10,urgent_needs:['air bersih'],field_provenance:{total_people:{source_excerpt:'x'.repeat(30000)}}};
 const original={content:[{type:'text',text:JSON.stringify({status:'ok',snapshot_id:id,snapshot_sha256:sha,records:[record]})}]};
 const compact=compactToolResult(original,'fetch_shelters');
 assert.ok(JSON.stringify(compact).length<JSON.stringify(original).length/10);
 const data=JSON.parse(compact.content[0].text!);assert.equal(data.records[0].stock.air_liter_per_hari,0);assert.equal(data.records[0].male,null);assert.equal(data.records[0].stock_context.air_liter_per_hari.horizon_hours,24);assert.equal(data.snapshot_id,id);assert.ok(original.content[0].text.includes('source_excerpt'));
});

test('structured validation runs source and validator with zero model calls and enforces permission',async()=>{
 const mcp=await scenarioMcp(),script=scriptedModel([]),runtime=new GeminiAgentRuntime({apiKey:'test-key',model:'gemini-3.8-flash'},script.model);
 try{
  await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
  const events:any[]=[];
  const options={sessionId:'one',batchId:'batch',requestId:'request',prompt:'',operation:'prepare' as const,filteredText:'lansia: 14',structuredRecord:{shelter_name:'Posko Uji',elderly:14}};
  await runtime.sendPrompt(options,e=>{events.push(e);},async()=>({allow:true}));
  assert.equal(script.inputs.length,0);
  const calls=mcp.requests.filter(r=>r.method==='tools/call');
  assert.deepEqual(calls.map(r=>r.params.name),['sigap_1_prepare_needs','sigap_2_validate_needs']);
  const args=JSON.parse(calls[1].params.arguments.input_value);
  assert.equal(args.records[0].report_id,'R001');assert.equal(args.records[0].elderly,14);assert.equal(args.batch_id,'source');
  assert.equal(events.filter(e=>e.event_type==='preview_ready').length,1);
  await assert.rejects(runtime.sendPrompt(options,()=>{},async()=>({allow:false,reason:'Denied'})),/Denied/);
  assert.equal(mcp.requests.filter(r=>r.method==='tools/call').length,2);
 }finally{await runtime.shutdown();await mcp.close();}
});

test('approved commit dispatches exact approved payload and verifies effective receipt without model',async()=>{
 const mcp=await scenarioMcp(name=>name==='sigap_5_upsert_shelter'?{content:[{type:'text',text:JSON.stringify({status:'saved',snapshot_id:id,snapshot_sha256:sha})}]}:name==='sigap_0_fetch_shelters'?{content:[{type:'text',text:'{"status":"ok","verification_status":"verified"}'}]}:undefined);
 const script=scriptedModel([]),runtime=new GeminiAgentRuntime({apiKey:'test-key',model:'gemini-3.8-flash'},script.model);
 const payload={snapshot_id:id,snapshot_sha256:sha,confirmed_by_officer:true};
 try{
  await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
  await runtime.sendPrompt({sessionId:'one',batchId:'batch',requestId:'request',prompt:'',operation:'commit',writePayload:payload},()=>{},async()=>({allow:true}));
  assert.equal(script.inputs.length,0);const calls=mcp.requests.filter(r=>r.method==='tools/call');
  assert.deepEqual(JSON.parse(calls[0].params.arguments.input_value),payload);
  assert.deepEqual(JSON.parse(calls[1].params.arguments.input_value),{action:'all',expected_snapshot_id:id,expected_snapshot_sha256:sha});
 }finally{await runtime.shutdown();await mcp.close();}
});

test('capable validator prepares structured corrections in one guarded call with zero model use',async()=>{
 for(const includeCalculation of [false,true]){
 const mcp=await scenarioMcp(undefined,{'sigap_2_validate_needs':'sigap:structured-source-v1'+(includeCalculation?' sigap:validated-calculation-v1':'')});
 const script=scriptedModel([]),runtime=new GeminiAgentRuntime({apiKey:'test-key',model:'test'},script.model);
 const source={report_text:'Mohon klarifikasi laporan R001 (Posko Uji): jumlah jiwa: 12.',candidate_target:{snapshot_id:id,snapshot_sha256:sha,record_index:0}};
 const options={sessionId:'combined',batchId:'batch',requestId:'request',prompt:'',operation:'prepare' as const,filteredText:JSON.stringify(source),structuredRecord:{shelter_name:'Posko Uji',total_people:12}};
 try{
  await runtime.initSession({sessionId:'combined',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
  const events:any[]=[];
  await runtime.sendPrompt(options,e=>{events.push(e);},async()=>({allow:true}));
  const calls=mcp.requests.filter(r=>r.method==='tools/call');
  assert.equal(calls.length,1);assert.equal(calls[0].params.name,'sigap_2_validate_needs');
  assert.deepEqual(JSON.parse(calls[0].params.arguments.input_value),{source_request:source,records:[{...options.structuredRecord,report_id:'R001'}],...(includeCalculation?{include_calculation:true}:{})});
  assert.equal(script.inputs.length,0);assert.equal(events.filter(e=>e.event_type==='preview_ready').length,1);
  await assert.rejects(runtime.sendPrompt(options,()=>{},async()=>({allow:false,reason:'Permission revoked'})),/Permission revoked/);
  assert.equal(mcp.requests.filter(r=>r.method==='tools/call').length,1);
 }finally{await runtime.shutdown();await mcp.close();}
 }
});

test('separate row snapshots retain independent data, provenance and immutable hashes',async()=>{
 const payload={snapshot_kind:'report_candidate',records:[{report_id:'R001',shelter_name:'A',total_people:10},{report_id:'R002',shelter_name:'B',total_people:20}],report_records:[],issues:[]};
 const hash=snapshotHash(payload),saved:any[]=[];
 const gateway=new SupabaseGateway({url:'https://example.supabase.co',publishableKey:'fixture',gatewaySecret:'x'.repeat(64),organizationId:'org'});
 gateway.call=async(action,args:any)=>{if(action==='flow.load')return {envelope:{created_at:10,sha256:hash,payload}} as any;saved.push(args);return true as any;};
 const parts=await splitRowSnapshots(gateway,'actor','workspace',{snapshot_id:id,snapshot_sha256:hash});
 assert.equal(parts.length,2);assert.notEqual(parts[0].snapshot_id,parts[1].snapshot_id);
 for(const item of saved){assert.equal(item.actor_id,'actor');assert.equal(item.context_id,'workspace');assert.equal(item.envelope.payload.records.length,1);assert.equal(snapshotHash(item.envelope.payload),item.envelope.sha256);}
 assert.equal(payload.records.length,2);
 await assert.rejects(splitRowSnapshots(gateway,'actor','workspace',{snapshot_id:id,snapshot_sha256:'bad'}),/aman/);
 assert.equal(saved.length,2);
});
