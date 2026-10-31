// Disposable local-only OCR sandbox. Do not configure this script as the production entrypoint.
import {buildServer} from '../src/server.js';
import {SigapRepository} from '../src/db/repo.js';
import {FakeAgentRuntime} from '../src/acp/fakeRuntime.js';
const repo=new SigapRepository(':memory:');
const {app}=await buildServer({repo,runtime:new FakeAgentRuntime(),sessionConfig:{},config:{agentProvider:'mock',host:'0.0.0.0',port:8798,allowedOrigins:['http://localhost:5173','http://127.0.0.1:5173'],bobCommand:'unused',bobArgs:'',bobWorkspace:'',langflowUrl:'http://127.0.0.1:1',snapshotDir:'',maxInputBytes:204800,retentionDays:7,approvalTtlSeconds:3600,dbPath:':memory:',sessionToken:'ocr-disposable-test-only'}});
await app.listen({host:'0.0.0.0',port:8798});
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{void app.close().then(()=>{repo.close();process.exit(0);});});
