// Full route -> native OCR smoke using an isolated in-memory repository and fake agent.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {buildServer} from '../src/server.js';
import {SigapRepository} from '../src/db/repo.js';
import {FakeAgentRuntime} from '../src/acp/fakeRuntime.js';

const repo=new SigapRepository(':memory:');
const {app}=await buildServer({repo,runtime:new FakeAgentRuntime(),sessionConfig:{},config:{agentProvider:'mock',host:'127.0.0.1',port:0,allowedOrigins:['http://localhost:5173'],bobCommand:'unused',bobArgs:'',bobWorkspace:'',langflowUrl:'http://127.0.0.1:1',snapshotDir:'',maxInputBytes:204800,retentionDays:7,approvalTtlSeconds:3600,dbPath:':memory:',sessionToken:'ocr-isolated-smoke-token'}});
try{
 const headers={authorization:'Bearer ocr-isolated-smoke-token'};
 const session=await app.inject({method:'POST',url:'/api/sessions',headers,payload:{}});assert.equal(session.statusCode,201);
 const id=session.json().session_id;
 const filename='laporan-dua-halaman.pdf';
 const result=await app.inject({method:'POST',url:`/api/sessions/${id}/documents/extract`,headers:{...headers,'content-type':'application/octet-stream','x-document-name':encodeURIComponent(filename)},payload:await readFile(join(resolve(process.argv[2]||'/fixtures'),filename))});
 assert.equal(result.statusCode,200,result.body);const document=result.json();assert.equal(document.pages,2);assert.match(document.text,/Posko Harapan/);assert.match(document.text,/Posko Melati/);assert.equal(await repo.countBatches(id),0);
 const response=await app.inject({method:'POST',url:`/api/sessions/${id}/messages`,headers,payload:{request_id:'ocr-explicit-smoke-send',text:document.text,filename:filename+'.ocr.txt'}});
 assert.equal(response.statusCode,202,response.body);assert.equal(await repo.countBatches(id),1);
 console.log('PASS binary PDF -> authenticated route -> real local OCR -> reviewed text accepted by existing message pipeline; no batch before explicit send. Isolated mock repository only.');
}finally{await app.close();repo.close();}
