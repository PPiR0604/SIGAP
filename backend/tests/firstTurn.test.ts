import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildServer} from '../src/server.js';
import {SigapRepository} from '../src/db/repo.js';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {call,done,scenarioMcp,scriptedModel} from './helpers/geminiScenario.js';

const stored={status:'ok',total_shelters:2,records:[
  {report_id:'R001',shelter_name:'Posko Uji',village:'Desa Uji',total_people:10},
  {report_id:'R002',shelter_name:'Posko Dua',village:'Desa Dua',total_people:20}]};

test('pesan pertama membaca rekap tersimpan lewat backend tanpa putaran model tambahan', async () => {
  const mcp = await scenarioMcp(name => name === 'sigap_0_fetch_shelters' ? {content:[{type:'text',text:JSON.stringify(stored)}]} : undefined);
  const script = scriptedModel([
    {role:'model',parts:[{text:'Halo, ada yang bisa dibantu?'}]},
    {role:'model',parts:[{text:'Baik.'}]}
  ]);
  const repo = new SigapRepository(':memory:');
  const runtime = new GeminiAgentRuntime({apiKey:'synthetic-test-key',model:'gemini-3.8-flash'},script.model);
  const config = {host:'127.0.0.1',port:0,allowedOrigins:[],bobCommand:'bob',bobArgs:'',bobWorkspace:'output/bob-workspace',
    langflowUrl:'http://localhost:7860',snapshotDir:'output/.sigap_snapshots',maxInputBytes:204800,retentionDays:7,
    approvalTtlSeconds:3600,dbPath:':memory:',sessionToken:'first-turn-test'};
  const {app,orchestrator} = await buildServer({config,repo,runtime,sessionConfig:{mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]}});
  const headers = {authorization:'Bearer first-turn-test'};
  try {
    const session = (await app.inject({method:'POST',url:'/api/sessions',headers,payload:{}})).json();
    const send = async (text:string,request_id:string) => {
      const response = await app.inject({method:'POST',url:`/api/sessions/${session.session_id}/messages`,headers,payload:{text,request_id}});
      assert.equal(response.statusCode,202,response.body);
      const batchId = response.json().batch_id as string;
      for (let i=0;i<400;i++) {
        if (repo.getBatch(batchId)?.status !== 'processing' && !orchestrator.isProcessing(session.session_id)) break;
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      return batchId;
    };
    const first = await send('halo','first');
    assert.equal(repo.getBatch(first)?.status,'conversation_done');
    const userText = (index:number) => JSON.stringify(script.inputs[index].contents.at(-1));
    assert.doesNotMatch(userText(0),/PESAN PERTAMA SESI|fetch_shelters/,'model tidak diminta membaca rekap');
    assert.equal(script.inputs.length,1,'hanya satu putaran model untuk sapaan');
    const fetchCalls = () => mcp.requests.filter(r=>r.method==='tools/call'&&r.params.name==='sigap_0_fetch_shelters').length;
    assert.equal(fetchCalls(),1,'backend membaca rekap sekali');
    const events = repo.getEventsAfter(session.session_id).filter(event=>event.batch_id===first);
    const storedEvent = events.find(event=>event.event_type==='stored_rekap_ready');
    assert.ok(storedEvent,'rekap tersimpan dikirim ke UI');
    const payload = JSON.parse(storedEvent!.payload_json);
    assert.equal(payload.records.length,2);
    assert.equal(payload.records[0].shelter_name,'Posko Uji');
    assert.equal(events.some(event=>event.event_type==='preview_ready'||event.event_type==='approval_required'),false,'rekap tersimpan bukan kandidat dan tidak butuh persetujuan');
    assert.equal(events.some(event=>event.event_type==='error'),false);
    assert.equal(repo.getBatch(first)?.latest_snapshot_id ?? null,null);

    const second = await send('terima kasih','second');
    assert.equal(repo.getBatch(second)?.status,'conversation_done');
    assert.equal(fetchCalls(),1,'pesan kedua tidak membaca ulang');
  } finally {await app.close();repo.close();await mcp.close();}
});
