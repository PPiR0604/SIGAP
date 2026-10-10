import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildServer} from '../src/server.js';import {SigapRepository} from '../src/db/repo.js';import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {call,done,id,sha,scenarioMcp,scriptedModel} from './helpers/geminiScenario.js';
const config={host:'127.0.0.1',port:0,allowedOrigins:[],bobCommand:'bob',bobArgs:'',bobWorkspace:'output/bob-workspace',langflowUrl:'http://localhost:7860',snapshotDir:'output/.sigap_snapshots',maxInputBytes:204800,retentionDays:7,approvalTtlSeconds:3600,dbPath:':memory:',sessionToken:'test-token'};
const auth={authorization:'Bearer test-token'};
const approved={snapshot_id:id,snapshot_sha256:sha,approved_snapshot_sha256:sha,confirmed_by_officer:true,allow_partial:false,clear_decisions:{},approved_clear_fields:{},confirmed_clear_fields:false,confirmed_clear_decisions:false};
async function waitFor(repo:SigapRepository,batchId:string,status:string){
  for(let i=0;i<200;i++){if(repo.getBatch(batchId)?.status===status)return;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.equal(repo.getBatch(batchId)?.status,status);
}
for(const scenario of ['verified','mismatch','failure','changed-write'])test(`Gemini HTTP approval flow: ${scenario}`,async()=>{
  const effectiveId='2'.repeat(32),effectiveSha='b'.repeat(64);
  const mcp=await scenarioMcp((name,_args,res)=>{
    if(name==='sigap_5_upsert_shelter')return {content:[{type:'text',text:JSON.stringify({status:'saved',snapshot_id:effectiveId,snapshot_sha256:effectiveSha})}]};
    if(name==='sigap_0_fetch_shelters'){
      if(scenario==='failure'){res.destroy();return null;}
      return {content:[{type:'text',text:JSON.stringify({status:'ok',verification_status:scenario==='mismatch'?'mismatch':'verified'})}]};
    }
    return undefined;
  });
  const script=scriptedModel([
    call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),
    call('sigap_2_validate_needs',{input_value:'{"batch_id":"source","source_sha256":"hash","records":[]}'}),done,
    call('sigap_5_upsert_shelter',{input_value:JSON.stringify(scenario==='changed-write'?{...approved,allow_partial:true}:approved)}),
    ...(scenario==='changed-write'?[done]:[call('sigap_0_fetch_shelters',{input_value:JSON.stringify({action:'all',expected_snapshot_id:effectiveId,expected_snapshot_sha256:effectiveSha})}),done])
  ]);
  const repo=new SigapRepository(':memory:');
  const runtime=new GeminiAgentRuntime({apiKey:'synthetic-test-key',model:'gemini-3.8-flash'},script.model);
  const {app}=await buildServer({config,repo,runtime,sessionConfig:{systemPrompt:'SIGAP test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]}});
  try{
    const session=(await app.inject({method:'POST',url:'/api/sessions',headers:auth,payload:{}})).json();
    const response=await app.inject({method:'POST',url:`/api/sessions/${session.session_id}/messages`,headers:auth,payload:{request_id:'r1',text:'Posko Uji 10 jiwa.'}});
    assert.equal(response.statusCode,202);const batchId=response.json().batch_id;
    await waitFor(repo,batchId,'ready_for_review');
    while((await app.inject({method:'GET',url:`/api/batches/${batchId}`,headers:auth})).json().status==='processing')await new Promise(resolve=>setTimeout(resolve,5));
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(mcp.requests.filter(r=>r.method==='tools/call'&&r.params.name==='sigap_5_upsert_shelter').length,0);
    const decision=await app.inject({method:'POST',url:`/api/batches/${batchId}/decisions`,headers:auth,payload:{action:'approve_save',snapshot_id:id,partial_acknowledged:false,clear_decisions:{}}});
    assert.equal(decision.statusCode,202);
    const expected=scenario==='verified'?'done':scenario==='mismatch'?'needs_review':'save_status_unknown';
    await waitFor(repo,batchId,expected);
    const writers=mcp.requests.filter(r=>r.method==='tools/call'&&r.params.name==='sigap_5_upsert_shelter');
    assert.equal(writers.length,scenario==='changed-write'?0:1);
    if(writers.length)assert.deepEqual(JSON.parse(writers[0].params.arguments.input_value),approved);
    const duplicate=await app.inject({method:'POST',url:`/api/batches/${batchId}/decisions`,headers:auth,payload:{action:'approve_save',snapshot_id:id,clear_decisions:{}}});
    assert.equal(duplicate.statusCode,409);
  }finally{await app.close();repo.close();await mcp.close();}
});

test('Gemini preserves a Langflow bulletin preview without invalidating the review candidate', async () => {
  const bulletin = { action: 'create_doc', content: '**DRAF**\n- Air bersih',
    content_sha256: 'c'.repeat(64), preview_at: '2026-10-08T10:00:00',
    confirmed_create_doc: false, approved_content_sha256: null, snapshot_id: id, snapshot_sha256: sha };
  const mcp = await scenarioMcp(name => name === 'sigap_6_draft_bulletin' ? {
    content: [
      { type: 'text', text: 'DITOLAK — tidak ada aksi eksternal: Pembuatan Google Docs belum disetujui.\n\nPratinjau (belum disimpan):\n' + JSON.stringify(bulletin, null, 2).replace(/\n/g, '\n\n') },
      { type: 'text', text: 'DITOLAK — tidak ada aksi eksternal: Pembuatan Google Docs belum disetujui.\n\nPratinjau (belum disimpan):\n' + JSON.stringify(bulletin, null, 2) }
    ]
  } : undefined);
  const script = scriptedModel([
    call('sigap_1_prepare_needs', { input_value: 'Posko Uji 10 jiwa.' }),
    call('sigap_2_validate_needs', { input_value: '{"batch_id":"source","source_sha256":"hash","records":[]}' }),
    call('sigap_6_draft_bulletin', { input_value: JSON.stringify({ action: 'preview', snapshot_id: id, snapshot_sha256: sha }) }), done
  ]);
  const repo = new SigapRepository(':memory:');
  const runtime = new GeminiAgentRuntime({ apiKey: 'synthetic-test-key', model: 'gemini-3.8-flash' }, script.model);
  const { app } = await buildServer({ config, repo, runtime, sessionConfig: {
    mcpServerConfig: [{ name: 'langflow', type: 'http', url: mcp.url, headers: [] }]
  } });
  try {
    const session = (await app.inject({ method: 'POST', url: '/api/sessions', headers: auth, payload: {} })).json();
    const response = await app.inject({ method: 'POST', url: `/api/sessions/${session.session_id}/messages`,
      headers: auth, payload: { request_id: 'bulletin-preview', text: 'Posko Uji 10 jiwa.' } });
    assert.equal(response.statusCode, 202);
    for (let i = 0; i < 200; i++) {
      if (repo.getEventsAfter(session.session_id).some(event => ['approval_required', 'error'].includes(event.event_type))) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const batch = repo.getBatch(response.json().batch_id)!;
    assert.equal(batch.status, 'ready_for_review');
    assert.deepEqual(JSON.parse(batch.bulletin_payload_json!), bulletin);
    const events = repo.getEventsAfter(session.session_id);
    assert.ok(events.some(event => event.event_type === 'bulletin_ready'));
    assert.ok(events.some(event => event.event_type === 'approval_required'));
    assert.equal(events.some(event => event.event_type === 'error'), false);
    assert.equal(mcp.requests.some(request => request.method === 'tools/call' && request.params.name === 'sigap_5_upsert_shelter'), false);
  } finally { await app.close(); repo.close(); await mcp.close(); }
});

test('Gemini whole-rekap bulletin replaces stale candidate reference with fresh full read-back',async()=>{
  const currentId='6'.repeat(32),currentSha='f'.repeat(64);
  const records=[{report_id:'R001',shelter_name:'Posko Air',total_people:91,urgent_needs:['air bersih']},{report_id:'R002',shelter_name:'Posko Harapan',total_people:98,urgent_needs:[]}];
  const mcp=await scenarioMcp(name=>name==='sigap_0_fetch_shelters'?{content:[{type:'text',text:JSON.stringify({status:'ok',total_shelters:2,matched_shelters:2,snapshot_id:currentId,snapshot_sha256:currentSha,records})}]}:
    name==='sigap_6_draft_bulletin'?{content:[{type:'text',text:JSON.stringify({action:'create_doc',content:'DRAF\n- air bersih',content_sha256:'c'.repeat(64),preview_at:'2026-10-09T23:48:00',confirmed_create_doc:false,snapshot_id:currentId,snapshot_sha256:currentSha,records})}]}:undefined);
  const script=scriptedModel([call('sigap_6_draft_bulletin',{input_value:JSON.stringify({action:'preview',snapshot_id:id,snapshot_sha256:sha})}),
    call('sigap_6_draft_bulletin',{input_value:JSON.stringify({action:'preview',snapshot_id:currentId,snapshot_sha256:currentSha})}),done]);
  const repo=new SigapRepository(':memory:');
  const runtime=new GeminiAgentRuntime({apiKey:'synthetic-test-key',model:'gemini-3.8-flash'},script.model);
  const {app}=await buildServer({config,repo,runtime,sessionConfig:{mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]}});
  try{
    const session=(await app.inject({method:'POST',url:'/api/sessions',headers:auth,payload:{}})).json();
    const response=await app.inject({method:'POST',url:`/api/sessions/${session.session_id}/messages`,headers:auth,payload:{request_id:'all-bulletin',text:'Tolong susun draf buletin donatur dari rekap yang ada saat ini. Hanya pratinjau (action preview), jangan membuat dokumen.'}});
    assert.equal(response.statusCode,202);await waitFor(repo,response.json().batch_id,'conversation_done');
    const payload=JSON.parse(repo.getBatch(response.json().batch_id)!.bulletin_payload_json!);
    assert.equal(payload.snapshot_id,currentId);assert.equal(payload.records.length,2);
    assert.ok(script.inputs[0].contents.some(t=>t.parts.some(p=>typeof p.text==='string'&&p.text.includes(currentId))));
    const calls=mcp.requests.filter(r=>r.method==='tools/call');
    assert.deepEqual(calls.map(r=>r.params.name),['sigap_0_fetch_shelters','sigap_6_draft_bulletin']);
    assert.equal(JSON.parse(calls[1].params.arguments.input_value).snapshot_id,currentId);
  }finally{await app.close();repo.close();await mcp.close();}
});
