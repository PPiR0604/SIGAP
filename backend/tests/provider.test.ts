import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildServer} from '../src/server.js';import {SigapRepository} from '../src/db/repo.js';
import type {AppConfig} from '../src/config.js';
const base={host:'127.0.0.1',port:0,allowedOrigins:[],bobCommand:'sigap-test-bob-unavailable',bobArgs:'',bobWorkspace:'output/bob-workspace',langflowUrl:'http://localhost:7860',snapshotDir:'output/.sigap_snapshots',maxInputBytes:204800,retentionDays:7,approvalTtlSeconds:3600,dbPath:':memory:',sessionToken:'test-token'};
test('explicit Gemini without a key is degraded and never silently becomes a mock',async()=>{
  const previous={key:process.env.GEMINI_API_KEY,path:process.env.SIGAP_GEMINI_CONFIG_PATH};
  const repo=new SigapRepository(':memory:');let app:any;
  try{
    process.env.GEMINI_API_KEY='';process.env.SIGAP_GEMINI_CONFIG_PATH='data/no-test-gemini-key.json';
    const built=await buildServer({repo,config:{...base,agentProvider:'gemini'} as AppConfig});app=built.app;
    const health=(await app.inject('/api/health')).json();
    assert.equal(health.agent,'gemini');assert.equal(health.bob,'not_used');assert.equal(health.provider_status,'unavailable');assert.equal(health.mode,'degraded');assert.equal(health.write_enabled,false);
    const session=(await app.inject({method:'POST',url:'/api/sessions',headers:{authorization:'Bearer test-token'},payload:{}})).json();
    const sent=(await app.inject({method:'POST',url:`/api/sessions/${session.session_id}/messages`,headers:{authorization:'Bearer test-token'},payload:{request_id:'r1',text:'Posko Uji 10 jiwa.'}})).json();
    await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal(repo.getBatch(sent.batch_id)?.status,'failed');assert.equal(repo.getBatch(sent.batch_id)?.latest_snapshot_id,null);
  }finally{await app?.close();repo.close();for(const [name,value] of Object.entries({GEMINI_API_KEY:previous.key,SIGAP_GEMINI_CONFIG_PATH:previous.path}))if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
test('mock remains explicit and rejects unknown provider configuration',async()=>{
  const repo=new SigapRepository(':memory:');const {app}=await buildServer({repo,config:{...base,agentProvider:'mock'} as AppConfig});
  try{const health=(await app.inject('/api/health')).json();assert.equal(health.agent,'mock');assert.equal(health.write_enabled,false);}
  finally{await app.close();repo.close();}
  const another=new SigapRepository(':memory:');
  try{await assert.rejects(buildServer({repo:another,config:{...base,agentProvider:'unknown'} as any}),/provider/i);}
  finally{another.close();}
});
