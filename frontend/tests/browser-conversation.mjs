// Runs the actual Fastify routes, repository, orchestrator and Gemini runtime.
// Model and MCP responses are synthetic; storage writes never leave this test.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {buildServer} from '../../backend/src/server.ts';
import {SigapRepository} from '../../backend/src/db/repo.ts';
import {GeminiAgentRuntime} from '../../backend/src/gemini/runtime.ts';
import {call,done,id,sha,candidate,scenarioMcp,scriptedModel} from '../../backend/tests/helpers/geminiScenario.ts';

const require = createRequire(path.join(process.env.SIGAP_BROWSER_PACKAGES||process.cwd(),'package.json'));
const {chromium} = require('playwright');
const frontendUrl = process.env.SIGAP_BROWSER_TEST_URL||'http://127.0.0.1:5173';
const nextId = '3'.repeat(32), nextSha = 'c'.repeat(64);
const receipt = args => JSON.parse(args.input_value);
const write = (snapshot_id,snapshot_sha256) => ({snapshot_id,snapshot_sha256,approved_snapshot_sha256:snapshot_sha256,
  confirmed_by_officer:true,allow_partial:false,clear_decisions:{},approved_clear_fields:{},confirmed_clear_fields:false,confirmed_clear_decisions:false});
const commit = (snapshot_id,snapshot_sha256) => [call('sigap_5_upsert_shelter',{input_value:JSON.stringify(write(snapshot_id,snapshot_sha256))}),
  call('sigap_0_fetch_shelters',{input_value:JSON.stringify({action:'all',expected_snapshot_id:snapshot_id,expected_snapshot_sha256:snapshot_sha256})}),done];
const reply = async () => {await new Promise(resolve=>setTimeout(resolve,200));return {role:'model',parts:[{text:'Jawaban lanjutan dari kandidat yang sudah diperiksa.'}]};};
let validationCount = 0;
const mcp = await scenarioMcp((name,args) => {
  let data;
  if(name==='sigap_2_validate_needs') data = ++validationCount===1 ? candidate : {...candidate,snapshot_id:nextId,snapshot_sha256:nextSha,
    records:[{report_id:'R002',shelter_name:'Posko Baru',village:'Desa Baru',total_people:20}]};
  if(name==='sigap_5_upsert_shelter') data = {status:'saved',snapshot_id:receipt(args).snapshot_id,snapshot_sha256:receipt(args).snapshot_sha256};
  if(name==='sigap_0_fetch_shelters') data = {status:'ok',verification_status:'verified'};
  return data ? {content:[{type:'text',text:JSON.stringify(data)}]} : undefined;
});
const validate = () => call('sigap_2_validate_needs',{input_value:'{"batch_id":"source","source_sha256":"hash","records":[]}'});
const script = scriptedModel([call('sigap_1_prepare_needs',{input_value:'Posko Uji 10 jiwa.'}),validate(),done,
  reply,reply,reply,...commit(id,sha),call('sigap_1_prepare_needs',{input_value:'Posko Baru 20 jiwa.'}),validate(),done,
  reply,...commit(nextId,nextSha)]);
const repo = new SigapRepository(':memory:');
const runtime = new GeminiAgentRuntime({apiKey:'synthetic-test-key',model:'gemini-3.8-flash'},script.model);
const {app} = await buildServer({repo,runtime,config:{host:'127.0.0.1',port:0,allowedOrigins:[new URL(frontendUrl).origin],bobCommand:'bob',bobArgs:'',
  bobWorkspace:'output/bob-workspace',langflowUrl:'http://localhost:7860',snapshotDir:'output/.sigap_snapshots',maxInputBytes:204800,
  retentionDays:7,approvalTtlSeconds:3600,dbPath:':memory:',sessionToken:'conversation-browser'},
  sessionConfig:{mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]}});
await app.listen({host:'127.0.0.1',port:0});
const backendUrl = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({headless:true,...(process.env.SIGAP_BROWSER_EXECUTABLE?{executablePath:process.env.SIGAP_BROWSER_EXECUTABLE}:{})});
try {
  const context = await browser.newContext();
  await context.addInitScript(()=>localStorage.setItem('sigap_token','conversation-browser'));
  const page = await context.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const messageBatches=[],decisions=[];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const target = backendUrl+url.pathname+url.search;
    if(url.pathname.endsWith('/messages')) {
      const response=await route.fetch({url:target});
      messageBatches.push((await response.json()).batch_id);
      // Force SSE to arrive before the HTTP acceptance for both report turns.
      if([1,5].includes(messageBatches.length)) await new Promise(resolve=>setTimeout(resolve,250));
      await route.fulfill({response});
    } else {
      if(url.pathname.endsWith('/decisions')) decisions.push({batchId:url.pathname.split('/')[3],...route.request().postDataJSON()});
      await route.continue({url:target});
    }
  });
  await page.goto(frontendUrl);
  await page.getByRole('button',{name:'LLM dikonfigurasi',exact:true}).waitFor();
  const input=page.getByLabel('Laporan atau pertanyaan Anda');
  const send=async text=>{await page.getByRole('button',{name:'Laporan',exact:true}).click();await input.fill(text);await page.getByRole('button',{name:'Kirim',exact:true}).click();};
  const settled=()=>page.waitForFunction(()=>document.querySelector('.chat-dock-heading span')?.textContent==='Asisten laporan lapangan'&&document.querySelector('#report-input')?.value==='');
  const review=()=>page.locator('[aria-labelledby="preview-title"]');
  const step=()=>page.locator('.steps [aria-current="step"]').textContent();
  await send('Posko Uji 10 jiwa.'); await review().getByRole('button',{name:/Posko Uji/}).waitFor(); await settled();
  assert.match(await step(),/Tinjau/);
  const version=await review().locator('.muted').textContent();
  for(const text of ['Berapa jiwa?', 'Apa yang perlu diperiksa?', 'Terima kasih']) {
    await send(text);
    assert.match(await step(),/Tinjau/,'Follow-up must not roll progress backward');
    assert.equal(await review().getByRole('button',{name:/Posko Uji/}).count(),1,'Sending preserves the candidate');
    await settled();
    assert.equal(await review().locator('.muted').textContent(),version,'Conversation does not create a candidate version');
  }
  const approve = async () => {
    await page.getByRole('button',{name:'Rekap',exact:true}).click();
    await page.getByRole('button',{name:'Tinjau & setujui',exact:true}).click();
    await page.getByLabel(/Saya menyetujui keputusan penyimpanan/).check();
    await page.getByRole('button',{name:'Konfirmasi persetujuan',exact:true}).click();
    await page.getByRole('button',{name:'Tersimpan & Terverifikasi',exact:true}).waitFor();
  };
  await approve();
  assert.equal(decisions[0].batchId,messageBatches[0]);assert.equal(decisions[0].snapshot_id,id);
  await send('Posko Baru 20 jiwa.');await review().getByRole('button',{name:/Posko Baru/}).waitFor();await settled();
  assert.equal(await review().getByRole('button',{name:/Posko Uji/}).count(),0);
  await send('Jelaskan rekap baru.'); await settled(); await approve();
  assert.equal(decisions[1].batchId,messageBatches[4]);assert.equal(decisions[1].snapshot_id,nextId);
  assert.equal(mcp.requests.filter(r=>r.method==='tools/call'&&r.params.name==='sigap_5_upsert_shelter').length,2);
  assert.deepEqual(errors,[]);
  // Disconnected demo stays at Input even after a message.
  await page.unroute('**/api/**');await page.route('**/api/**',route=>route.fulfill({status:503,body:'Disconnected test'}));
  await page.reload();await send('Halo');assert.match(await step(),/Input/);
  console.log('PASS: actual backend API; three chats preserve progress/candidate; original approval succeeds; new report and second approval succeed; early SSE keeps correct batch; demo stays at Input.');
} finally {await browser.close();await app.close();repo.close();await mcp.close();}
