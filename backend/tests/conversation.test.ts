import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildServer} from '../src/server.js';
import {SigapRepository} from '../src/db/repo.js';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {call,done,id,sha,scenarioMcp,scriptedModel} from './helpers/geminiScenario.js';

test('three follow-up conversations preserve the review candidate and its approval', async () => {
  const mcp = await scenarioMcp(name => {
    if (name === 'sigap_5_upsert_shelter') return {content:[{type:'text',text:JSON.stringify({status:'saved',snapshot_id:id,snapshot_sha256:sha})}]};
    if (name === 'sigap_0_fetch_shelters') return {content:[{type:'text',text:JSON.stringify({status:'ok',verification_status:'verified'})}]};
    return undefined;
  });
  const write = {snapshot_id:id,snapshot_sha256:sha,approved_snapshot_sha256:sha,confirmed_by_officer:true,
    allow_partial:false,clear_decisions:{},approved_clear_fields:{},confirmed_clear_fields:false,confirmed_clear_decisions:false};
  const script = scriptedModel([
    call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),
    call('sigap_2_validate_needs',{input_value:'{"batch_id":"source","source_sha256":"hash","records":[]}'}),done,
    ...['Ada 10 jiwa dalam kandidat.', 'Silakan periksa sebelum menyetujui.', 'Sama-sama.'].map(text=>({role:'model' as const,parts:[{text}]})),
    call('sigap_5_upsert_shelter',{input_value:JSON.stringify(write)}),
    call('sigap_0_fetch_shelters',{input_value:JSON.stringify({action:'all',expected_snapshot_id:id,expected_snapshot_sha256:sha})}),done,
    call('sigap_1_prepare_needs',{input_value:'Posko Uji 11 jiwa.'}),done
  ]);
  const repo = new SigapRepository(':memory:');
  const runtime = new GeminiAgentRuntime({apiKey:'synthetic-test-key',model:'gemini-3.8-flash'},script.model);
  const config = {host:'127.0.0.1',port:0,allowedOrigins:[],bobCommand:'bob',bobArgs:'',bobWorkspace:'output/bob-workspace',
    langflowUrl:'http://localhost:7860',snapshotDir:'output/.sigap_snapshots',maxInputBytes:204800,retentionDays:7,
    approvalTtlSeconds:3600,dbPath:':memory:',sessionToken:'conversation-test'};
  const {app,orchestrator} = await buildServer({config,repo,runtime,sessionConfig:{mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]}});
  const headers = {authorization:'Bearer conversation-test'};
  try {
    const session = (await app.inject({method:'POST',url:'/api/sessions',headers,payload:{}})).json();
    const wait = async (batchId:string) => {
      for (let i=0;i<400;i++) {
        if (repo.getBatch(batchId)?.status !== 'processing' && !orchestrator.isProcessing(session.session_id)) return;
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      assert.fail('Operation did not finish');
    };
    const send = async (text:string,request_id:string) => {
      const response = await app.inject({method:'POST',url:`/api/sessions/${session.session_id}/messages`,headers,payload:{text,request_id}});
      assert.equal(response.statusCode,202,response.body);
      await wait(response.json().batch_id);
      return response.json().batch_id as string;
    };
    const reportBatch = await send('Posko Uji 10 jiwa.','report');
    assert.equal(repo.getBatch(reportBatch)?.status,'ready_for_review');
    for (const [i,text] of ['Berapa jiwa?', 'Apa yang perlu saya periksa?', 'Terima kasih'].entries()) {
      const chatBatch = await send(text,'chat-'+i);
      assert.equal(repo.getBatch(chatBatch)?.status,'conversation_done');
      assert.equal(repo.getBatch(reportBatch)?.latest_snapshot_id,id);
      assert.equal(repo.getBatch(reportBatch)?.status,'ready_for_review');
      const events = repo.getEventsAfter(session.session_id).filter(event=>event.batch_id===chatBatch);
      assert.equal(events.some(event=>event.event_type==='error'),false);
      assert.ok(events.some(event=>event.event_type==='processing_completed'));
    }
    const replay = await app.inject({method:'GET',url:`/api/sessions/${session.session_id}/events?stream=false`,headers});
    const previewFrame = replay.body.split('\n\n').find(frame=>frame.includes('event: preview_ready'))!;
    const previewPayload = JSON.parse(previewFrame.split('\n').find(line=>line.startsWith('data:'))!.slice(5));
    assert.equal(previewPayload.batch_id,reportBatch,'SSE binds a candidate to its own batch');
    assert.equal(previewPayload.snapshot_id,id);
    const approval = await app.inject({method:'POST',url:`/api/batches/${reportBatch}/decisions`,headers,
      payload:{action:'approve_save',snapshot_id:id,partial_acknowledged:false,clear_decisions:{}}});
    assert.equal(approval.statusCode,202,approval.body);
    for(let i=0;i<400 && repo.getBatch(reportBatch)?.status!=='done';i++) await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(repo.getBatch(reportBatch)?.status,'done');
    assert.equal(mcp.requests.filter(request=>request.method==='tools/call'&&request.params.name==='sigap_5_upsert_shelter').length,1);
    const incomplete = await send('Posko Uji 11 jiwa.','incomplete-report');
    assert.equal(repo.getBatch(incomplete)?.status,'needs_review','A report started without a validator must not count as a successful conversation');
    const incompleteEvents = repo.getEventsAfter(session.session_id).filter(event=>event.batch_id===incomplete);
    assert.ok(incompleteEvents.some(event=>event.event_type==='error'&&JSON.parse(event.payload_json).code==='INCOMPLETE_EXECUTION'));
    assert.ok(incompleteEvents.some(event=>event.event_type==='processing_completed'));
  } finally {await app.close();repo.close();await mcp.close();}
});
