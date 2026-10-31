import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SupabaseGateway,AuthProviderError} from '../src/supabase/client.js';
import {AuthService,type Membership} from '../src/auth/service.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {buildServer} from '../src/server.js';
import {FakeAgentRuntime} from '../src/acp/fakeRuntime.js';
import type {AppConfig} from '../src/config.js';
import {createHash,createHmac} from 'node:crypto';
import type {DocumentExtractor} from '../src/routes/documents.js';
import {snapshotHash} from '../src/pipeline/rowDrafts.js';
const org='11111111-1111-4111-8111-111111111111';
const jsonbOrder=(value:any):any=>Array.isArray(value)?value.map(jsonbOrder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort((a,b)=>a.length-b.length||a.localeCompare(b)).map(key=>[key,jsonbOrder(value[key])])):value;
class FakeGateway extends SupabaseGateway{
 jsonb=false;
 readonly entities=new Map<string,any>();readonly profiles=new Map<string,Membership>();readonly revoked=new Set<string>();
 readonly tokens=new Map<string,{id:string;claims:any}>();seq=0;
 readonly userOverrides=new Map<string,any>();
 constructor(){super({url:'https://example.supabase.co',publishableKey:'public-fixture',gatewaySecret:'x'.repeat(64),organizationId:org});}
 identity(id:string,role:Membership['role']='petugas',status:Membership['status']='active',scopes=['posko-a']){
  const claims={sub:id,session_id:id+'-session',exp:Math.floor(Date.now()/1000)+3600};const token='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
  this.tokens.set(token,{id,claims});this.profiles.set(id,{user_id:id,organization_id:org,role,status,scopes,display_name:id});return token;
 }
 override async auth(path:string,body?:any,token?:string,method?:string):Promise<any>{
  if(path==='user'){const user=this.tokens.get(token??'');if(!user)throw new Error('unauthorized');return {id:user.id,user_metadata:{role:'admin'},...this.userOverrides.get(user.id)};}
  if(path==='signup')return {user:{id:'new-user'},access_token:'unused-signup-session'};
  if(path.startsWith('logout'))return {};
  throw new Error('Unsupported fixture auth request');
 }
 override async call<T=any>(action:string,args:any={}):Promise<T>{
  let result:any;
  if(action==='session.valid')result=!this.revoked.has(args.session_id);
  else if(action==='session.revoke'){this.revoked.add(args.session_id);result=true;}
  else if(action==='profile.ensure'||action==='profile.get')result=this.profiles.get(args.user_id)??{user_id:args.user_id,status:'pending',role:null,organization_id:null,scopes:[]};
  else if(action==='scope.check'){const p=this.profiles.get(args.actor_id);if(!p||p.status!=='active'||!['admin','petugas'].includes(p.role??'')||p.role!=='admin'&&!p.scopes.includes(args.context_id))throw new Error('Denied');result=p;}
  else if(action==='entity.get')result=this.entities.get(args.kind+':'+args.id)??null;
  else if(action==='entity.list')result=[...this.entities].filter(([k,v])=>k.startsWith(args.kind+':')&&Object.entries(args.filter??{}).every(([a,b])=>v[a]===b)).map(([,v])=>v);
  else if(action==='entity.put'){const key=args.kind+':'+args.id;if(this.entities.has(key))throw new Error('Duplicate');result=this.jsonb?jsonbOrder(args.document):structuredClone(args.document);if(args.kind==='events')result.event_id=++this.seq;this.entities.set(key,result);}
  else if(action==='entity.patch'){const key=args.kind+':'+args.id,old=this.entities.get(key);if(!old||Object.entries(args.expected??{}).some(([k,v])=>old[k]!==v))return null as T;result=this.jsonb?jsonbOrder({...old,...args.patch}):{...old,...args.patch};this.entities.set(key,result);}
  else if(action==='approval.consume'){const a=this.entities.get('approvals:'+args.id);result=a?.status==='pending';if(result)a.status='consumed';}
  else if(action==='publications.list')result=[{content:'Approved summary'}];
  else if(action==='admin.users')result=[...this.profiles.values()];
  else if(action==='bootstrap.admin'){const id=[...this.userOverrides].find(([,u])=>u.email===args.email)?.[0];if(!id||[...this.profiles.values()].some(p=>p.role==='admin'&&p.status==='active'))throw new Error('Bootstrap denied');const p=this.profiles.get(id)!;p.role='admin';p.status='active';p.organization_id=org;result={user_id:id,role:'admin'};}
  else throw new Error('Unexpected fixture operation '+action);
  return structuredClone(result) as T;
 }
}
async function fixture(documentExtractor?:DocumentExtractor,runtime=new FakeAgentRuntime()){const gateway=new FakeGateway(),auth=new AuthService(gateway),repo=new SupabaseRepository(gateway);
 const config:AppConfig={host:'127.0.0.1',port:0,allowedOrigins:['http://localhost:5173'],bobCommand:'bob',bobArgs:'',bobWorkspace:'',langflowUrl:'',snapshotDir:'',maxInputBytes:204800,retentionDays:7,approvalTtlSeconds:3600,dbPath:':memory:',sessionToken:'old-shared-token'};
 const server=await buildServer({config,repo,auth,runtime,documentExtractor});await server.app.ready();return {...server,gateway,auth};}

async function publicationFixture(){
 const f=await fixture(),token=f.gateway.identity('publisher','admin'),headers={authorization:'Bearer '+token};
 f.gateway.jsonb=true;
 const s=(await f.app.inject({method:'POST',url:'/api/sessions',headers,payload:{context_id:'posko-a'}})).json();
 const batch=await f.repo.createBatch({sessionId:s.session_id,requestId:'public-fixture',contextId:'posko-a',sourceSha256:'a',sourceLength:1,filteredText:'private source',piiSummary:{}});
 const record={batch_id:'private-batch',report_id:'private-report',shelter_name:'Posko Uji',village:'Desa A',total_people:10,male:4,female:6,infants_toddlers:0,children:2,elderly:1,pregnant:0,breastfeeding:0,disability:0,urgent_needs:['air bersih'],field_provenance:{male:{source_excerpt:'PRIVATE ORIGINAL REPORT'}},contact:'secret@example.test'};
 const content='# Buletin Uji\n\n10 jiwa membutuhkan air. Hubungi secret@example.test';
 const draft={content,content_sha256:createHash('sha256').update(content).digest('hex'),snapshot_id:'1'.repeat(32),snapshot_sha256:'a'.repeat(64),records:[record],source_metadata:{snapshot_id:'1'.repeat(32),snapshot_sha256:'a'.repeat(64),records:[record],context_name:'Operasi Uji',kind:'stored',generated_at:'2026-10-30T01:00:00Z'}};
 await f.repo.updateBatchStatus(batch.batch_id,'conversation_done',{bulletin_payload_json:JSON.stringify(draft)});
 f.orchestrator.readBulletinCalculation=async b=>{assert.equal(b.batch_id,batch.batch_id);return {shelters:[{shelter_name:'Posko Uji',village:'Desa A',total_people:10,needs:{air_liter_per_hari:{value:150},kkal_per_hari:{value:21000},jamban_unit:{value:1},ruang_hunian_m2:{value:35}},gaps:{air_liter_per_hari:0},priority:'RENDAH'}]} as any;};
 const approved:any[]=[],original=f.gateway.call.bind(f.gateway);
 f.gateway.call=async(action,args:any={})=>{
  if(action==='publications.list')return approved as any;
  if(action==='publication.approve'){const result={id:'pub-fixture',context_id:args.context_id,content_sha256:args.content_sha256};approved.push(result);return result as any;}
  return original(action,args);
 };
 const url=`/api/batches/${batch.batch_id}`;
 const review=async()=>{const response=await f.app.inject({url:url+'/publication-preview',headers});assert.equal(response.statusCode,200,response.body);return response.json();};
 const publish=async(r:any,extra={})=>f.app.inject({method:'POST',url:url+'/publication/public',headers,payload:{review_id:r.review_id,review_sha256:r.review_sha256,public_acknowledged:true,...extra}});
 return {...f,token,headers,batch,draft,url,review,publish,approved};
}

test('anonymous publication is an approved immutable projection with no operational/private fields',async()=>{
 const f=await publicationFixture();try{
  const r=await f.review();assert.equal(f.approved.length,0,'review must not publish');
  assert.equal(r.data.calculation_available,true);assert.equal(r.data.records[0].requirements.air_liter_per_hari,150);
  assert.doesNotMatch(JSON.stringify(r.data),/PRIVATE ORIGINAL|secret@example|private-batch|private-report|field_provenance/);
  const response=await f.publish(r);assert.equal(response.statusCode,200,response.body);const link=response.json();
  assert.match(link.path,/^\/publikasi\/[A-Za-z0-9_-]{43}$/);assert.equal(f.approved.length,1);
  const path=link.path.replace('/publikasi/','/api/public/bulletins/');
  const publicRead=await f.app.inject({url:path});assert.equal(publicRead.statusCode,200,publicRead.body);assert.equal(publicRead.headers['cache-control'],'no-store');
  assert.equal(publicRead.json().records[0].requirements.air_liter_per_hari,150);assert.equal(publicRead.json().records[0].infants_toddlers,0);
  assert.doesNotMatch(publicRead.body,/PRIVATE ORIGINAL|secret@example|private-batch|share_id|organization_id|actor_id|session_id/);
  await f.repo.updateBatchStatus(f.batch.batch_id,'conversation_done',{bulletin_payload_json:JSON.stringify({...f.draft,content:'NEW PRIVATE DRAFT'})});
  assert.equal((await f.app.inject({url:path})).body,publicRead.body,'published source must not follow workspace changes');
  assert.equal((await f.app.inject({url:f.url})).statusCode,401);
  assert.equal((await f.app.inject({url:'/api/public/bulletins/'+'x'.repeat(43)})).statusCode,404);
  assert.equal((await f.app.inject({url:'/api/public/bulletins'})).statusCode,401);
 }finally{await f.app.close();}
});

test('public publication requires admin, explicit acknowledgment and the exact reviewed data',async()=>{
 const f=await publicationFixture();try{
  const officer=f.gateway.identity('officer','petugas'),viewer=f.gateway.identity('viewer','viewer');
  for(const token of [officer,viewer])for(const endpoint of ['/publication-preview','/publication-link','/publication/public']){
   const response=await f.app.inject({method:endpoint.endsWith('/public')?'POST':'GET',url:f.url+endpoint,headers:{authorization:'Bearer '+token},...(endpoint.endsWith('/public')?{payload:{}}:{})});assert.equal(response.statusCode,403);
  }
  const r=await f.review();assert.equal((await f.publish(r,{public_acknowledged:false})).statusCode,422);
  assert.equal((await f.publish(r,{review_sha256:'f'.repeat(64)})).statusCode,409);
  const other=f.gateway.identity('another-admin','admin');assert.equal((await f.app.inject({method:'POST',url:f.url+'/publication/public',headers:{authorization:'Bearer '+other},payload:{review_id:r.review_id,review_sha256:r.review_sha256,public_acknowledged:true}})).statusCode,409);
  await f.repo.updateBatchStatus(f.batch.batch_id,'conversation_done',{bulletin_payload_json:JSON.stringify({...f.draft,source_metadata:{...f.draft.source_metadata,records:[]}})});
  assert.equal((await f.publish(r)).statusCode,409,'same content with changed source still needs review');assert.equal(f.approved.length,0);
 }finally{await f.app.close();}
});

test('public link is recovered after refresh, idempotent on retry and revoked only by admin',async()=>{
 const f=await publicationFixture();try{
  const r=await f.review(),first=(await f.publish(r)).json(),second=(await f.publish(r)).json();assert.deepEqual(first,second);assert.equal(f.approved.length,1);
  assert.deepEqual((await f.app.inject({url:f.url+'/publication-link',headers:f.headers})).json().link,first);
  const history=await f.app.inject({url:'/api/contexts/posko-a/publication-links',headers:f.headers});assert.equal(history.statusCode,200);assert.equal(history.json()[0].share_id,first.share_id);
  const revoke=f.url+'/publication-link/'+first.share_id;
  assert.equal((await f.app.inject({method:'DELETE',url:revoke})).statusCode,401);
  const officer=f.gateway.identity('officer','petugas');assert.equal((await f.app.inject({method:'DELETE',url:revoke,headers:{authorization:'Bearer '+officer}})).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/contexts/posko-a/publication-links',headers:{authorization:'Bearer '+officer}})).statusCode,403);
  assert.equal((await f.app.inject({method:'DELETE',url:revoke,headers:f.headers})).statusCode,204);
  assert.equal((await f.app.inject({url:first.path.replace('/publikasi/','/api/public/bulletins/')})).statusCode,404);
  assert.equal((await f.app.inject({url:f.url+'/publication-link',headers:f.headers})).json().link,null);
  const renewed=(await f.publish(r)).json();assert.notEqual(renewed.path,first.path);assert.equal(f.approved.length,1);
 }finally{await f.app.close();}
});

test('unavailable source calculations stay unknown and publication reviews expire',async t=>{
 const f=await publicationFixture();try{
  f.orchestrator.readBulletinCalculation=async()=>{throw new Error('source expired');};
  const r=await f.review();assert.equal(r.data.calculation_available,false);assert.equal(r.data.records[0].requirements.air_liter_per_hari,null);
  const later=Date.now()+16*60000;t.mock.method(Date,'now',()=>later);
  assert.equal((await f.publish(r)).statusCode,409);assert.equal(f.approved.length,0);
 }finally{await f.app.close();}
});

test('multi-shelter source becomes independent durable batches; approving parent is rejected',async()=>{
 const records=[{report_id:'R001',shelter_name:'A',village:'Desa A',total_people:10},{report_id:'R002',shelter_name:'B',village:'Desa B',total_people:20}];
 const parent={snapshot_kind:'report_candidate',records,report_records:records,issues:[]},hash=snapshotHash(parent),reference='a'.repeat(32);
 const runtime=new FakeAgentRuntime({prepareNeedsOutput:JSON.stringify({snapshot_id:reference,snapshot_sha256:hash,records,issues:[]})});
 const f=await fixture(undefined,runtime);try{
  const original=f.gateway.call.bind(f.gateway);
  f.gateway.call=async(action,args:any={})=>{
   if(action==='flow.load')return {envelope:{created_at:Date.now()/1000,sha256:hash,payload:parent}} as any;
   if(action==='flow.save')return true as any;
   return original(action,args);
  };
  const token=f.gateway.identity('draft-owner'),headers={authorization:'Bearer '+token};
  const s=(await f.app.inject({method:'POST',url:'/api/sessions',headers,payload:{context_id:'posko-a'}})).json();
  const response=await f.app.inject({method:'POST',url:`/api/sessions/${s.session_id}/messages`,headers,payload:{request_id:'two',text:'Posko A 10 jiwa. Posko B 20 jiwa.'}});
  assert.equal(response.statusCode,202);
  for(let i=0;i<200;i++){if(!f.orchestrator.isProcessing(s.session_id)&&(await f.repo.getBatch(response.json().batch_id))?.status==='split_for_review')break;await new Promise(r=>setTimeout(r,5));}
  const reviews=await f.repo.getReviewSnapshots(s.session_id);assert.equal(reviews.length,2);
  assert.notEqual(reviews[0].batch_id,reviews[1].batch_id);assert.notEqual(reviews[0].snapshot_id,reviews[1].snapshot_id);
  assert.deepEqual(reviews.map(r=>JSON.parse(r.payload_json).records.length),[1,1]);
  const reject=await f.app.inject({method:'POST',url:`/api/batches/${response.json().batch_id}/decisions`,headers,payload:{action:'approve_save',snapshot_id:reference}});assert.notEqual(reject.statusCode,202);
  assert.equal([...f.gateway.entities.keys()].filter(k=>k.startsWith('approvals:')).length,0);
 }finally{await f.app.close();}
});

test('workspace resumes only its owner session and recovers durable drafts without replaying old approvals',async()=>{
 const f=await fixture();try{
  const a=f.gateway.identity('resume-a'),b=f.gateway.identity('resume-b'),headers={authorization:'Bearer '+a};
  const original=f.gateway.call.bind(f.gateway);
  f.gateway.call=async(action,args:any={})=>action==='storage.read'?{revision:1,document:{header:['posko','desa','jumlah_jiwa'],rows:[['Posko A','Desa A','10']]}} as any:original(action,args);
  const create=async(token:string,resume=false)=>f.app.inject({method:'POST',url:'/api/sessions',headers:{authorization:'Bearer '+token},payload:{context_id:'posko-a',resume}});
  const first=(await create(a)).json(),other=(await create(b)).json();
  const batch=await f.repo.createBatch({sessionId:first.session_id,requestId:'draft',contextId:'posko-a',sourceSha256:'a',sourceLength:1,filteredText:'safe',piiSummary:{}});
  await f.repo.saveSnapshot({snapshotId:'a'.repeat(32),snapshotSha256:'b'.repeat(64),batchId:batch.batch_id,version:1,qualityStatus:'OK',payload:{records:[{report_id:'R001',shelter_name:'Posko A',total_people:12}]}});
  await f.repo.appendEvent({sessionId:first.session_id,batchId:batch.batch_id,eventType:'preview_ready',payload:{old:'event'}});
  const resumed=await create(a,true);assert.equal(resumed.json().session_id,first.session_id);assert.equal(resumed.json().resumed,true);
  assert.equal((await create(b,true)).json().session_id,other.session_id);
  const state=await f.app.inject({url:`/api/sessions/${first.session_id}/recovery`,headers});assert.equal(state.statusCode,200);
  assert.equal(state.json().reviews.length,1);assert.equal(state.json().reviews[0].batchId,batch.batch_id);assert.equal(state.json().records[0].total_people,10);assert.ok(state.json().after_event_id>0);
  assert.equal((await f.app.inject({url:`/api/sessions/${first.session_id}/recovery`,headers:{authorization:'Bearer '+b}})).statusCode,404);
  assert.equal((await f.app.inject({method:'POST',url:'/api/sessions',headers,payload:{context_id:'another-context',resume:true}})).statusCode,403);
 }finally{await f.app.close();}
});

test('OCR requires an active assigned account and session ownership, without creating a model batch or storage write',async()=>{
 let calls=0;const f=await fixture(async(bytes,name)=>{calls++;assert.equal(bytes.toString(),'%PDF-fixture');assert.equal(name,'laporan.pdf');return {text:'Posko Uji: 10 jiwa',filename:name,pages:1,engine:'tesseract',source_sha256:'a'.repeat(64),warnings:['Periksa hasil OCR.']};});
 try{
  const officer=f.gateway.identity('officer-a'),other=f.gateway.identity('officer-b'),viewer=f.gateway.identity('viewer','viewer'),pending=f.gateway.identity('pending',null,'pending');
  const session=await f.app.inject({method:'POST',url:'/api/sessions',headers:{authorization:'Bearer '+officer},payload:{context_id:'posko-a'}});assert.equal(session.statusCode,201);const id=session.json().session_id;
  const request={method:'POST' as const,url:`/api/sessions/${id}/documents/extract`,payload:Buffer.from('%PDF-fixture')};
  const headers={'content-type':'application/octet-stream','x-document-name':encodeURIComponent('laporan.pdf')};
  for(const [token,status]of [[null,401],[viewer,403],[pending,403],[other,404]] as const){assert.equal((await f.app.inject({...request,headers:{...headers,...(token?{authorization:'Bearer '+token}:{})}})).statusCode,status);}
  assert.equal(calls,0);
  const result=await f.app.inject({...request,headers:{...headers,authorization:'Bearer '+officer}});assert.equal(result.statusCode,200);assert.equal(result.json().text,'Posko Uji: 10 jiwa');assert.equal(result.headers['cache-control'],'no-store');assert.equal(calls,1);
  assert.equal([...f.gateway.entities.keys()].filter(k=>/^(batches|approvals|snapshots):/.test(k)).length,0);
  f.gateway.profiles.get('officer-a')!.scopes=[];assert.equal((await f.app.inject({...request,headers:{...headers,authorization:'Bearer '+officer}})).statusCode,403);assert.equal(calls,1);
 }finally{await f.app.close();}
});
test('OCR bounds binary bodies, validates upload metadata and rejects concurrent extraction in the same session',async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 const f=await fixture(async(_bytes,name)=>{calls++;await held;return {text:'OCR fixture',filename:name,pages:1,engine:'tesseract',source_sha256:'b'.repeat(64),warnings:[]};});
 try{
  const token=f.gateway.identity('officer'),headers={authorization:'Bearer '+token,'content-type':'application/octet-stream','x-document-name':'report.pdf'};
  const session=await f.app.inject({method:'POST',url:'/api/sessions',headers:{authorization:'Bearer '+token},payload:{context_id:'posko-a'}});const url=`/api/sessions/${session.json().session_id}/documents/extract`;
  assert.equal((await f.app.inject({method:'POST',url,headers:{...headers,'x-document-name':'%broken'},payload:Buffer.from('%PDF-fixture')})).statusCode,422);
  assert.equal((await f.app.inject({method:'POST',url,headers,payload:Buffer.alloc(5*1024*1024+1)})).statusCode,413);assert.equal(calls,0);
  const first=f.app.inject({method:'POST',url,headers,payload:Buffer.from('%PDF-fixture')});
  await new Promise<void>((resolve,reject)=>{const start=Date.now();const poll=()=>{if(calls)resolve();else if(Date.now()-start>3000)reject(new Error('OCR did not start'));else setTimeout(poll,5);};poll();});
  const busy=await f.app.inject({method:'POST',url,headers,payload:Buffer.from('%PDF-fixture')});assert.equal(busy.statusCode,429);assert.equal(busy.json().error.code,'OCR_BUSY');assert.equal(calls,1);
  release();assert.equal((await first).statusCode,200);
 }finally{release?.();await f.app.close();}
});
test('OCR rate limit is per authenticated actor across sessions and does not invoke the engine after the limit',async()=>{
 let calls=0;const f=await fixture(async(_bytes,filename)=>{calls++;return {text:'OCR fixture',filename,pages:1,engine:'tesseract',source_sha256:'a'.repeat(64),warnings:[]};});
 try{
  const token=f.gateway.identity('officer'),auth={authorization:'Bearer '+token};const ids:string[]=[];
  for(let i=0;i<2;i++)ids.push((await f.app.inject({method:'POST',url:'/api/sessions',headers:auth,payload:{context_id:'posko-a'}})).json().session_id);
  for(let i=0;i<13;i++){
   const response=await f.app.inject({method:'POST',url:`/api/sessions/${ids[i%2]}/documents/extract`,headers:{...auth,'content-type':'application/octet-stream','x-document-name':'scan.pdf'},payload:Buffer.from('%PDF-fixture')});
   assert.equal(response.statusCode,i<12?200:429);if(i===12){assert.equal(response.json().error.code,'OCR_RATE_LIMITED');assert.ok(response.headers['retry-after']);}
  }
  assert.equal(calls,12);
 }finally{await f.app.close();}
});

test('password recovery is explicit, generic for unknown accounts and uses a server-controlled redirect',async()=>{
 const f=await fixture();try{
  const calls:any[]=[];f.gateway.auth=async(path:string,body?:any,token?:string,method?:string,redirectTo?:string)=>{calls.push({path,body,token,method,redirectTo});return {};};
  const request={method:'POST' as const,url:'/api/auth/password/reset',payload:{email:'fixture@example.test'}};
  assert.equal((await f.app.inject({...request,payload:{...request.payload,redirect_to:'https://evil.example/'}})).statusCode,422);assert.equal(calls.length,0);
  const result=await f.app.inject(request);assert.equal(result.statusCode,202);assert.match(result.json().message,/belum memastikan email terkirim/);
  assert.deepEqual(calls,[{path:'recover',body:request.payload,token:undefined,method:'POST',redirectTo:'http://localhost:5173/?auth=recovery'}]);
  f.gateway.auth=async()=>{throw new AuthProviderError(404,'user_not_found');};
  assert.deepEqual((await f.app.inject(request)).json(),result.json());
  f.gateway.auth=async()=>{throw new AuthProviderError(429,'over_request_rate_limit',30);};
  const limited=await f.app.inject(request);assert.equal(limited.statusCode,429);assert.equal(limited.headers['retry-after'],'30');
 }finally{await f.app.close();}
});
test('recovery verifies token ownership upstream before updating; no app session or access grant',async()=>{
 const f=await fixture();try{
  const calls:any[]=[];let membershipCalls=0;
  f.gateway.call=async()=>{membershipCalls++;throw new Error('Recovery must not provision app access');};
  f.gateway.auth=async(path,body,token,method)=>{calls.push({path,body,token,method});return path==='user'&&method==='GET'?{id:'owned-user'}:{};};
  const request={method:'POST' as const,url:'/api/auth/password/recover',payload:{password:'Uji12345'}};
  assert.equal((await f.app.inject(request)).statusCode,401);assert.equal(calls.length,0);
  const headers={authorization:'Bearer synthetic-recovery-token-for-owned-user'};
  assert.equal((await f.app.inject({...request,headers,payload:{password:'Uji1234'}})).statusCode,422);
  assert.equal((await f.app.inject({...request,headers,payload:{...request.payload,user_id:'another-user'}})).statusCode,422);
  const result=await f.app.inject({...request,headers});assert.equal(result.statusCode,204);assert.equal(result.headers['cache-control'],'no-store');
  assert.deepEqual(calls.map(c=>[c.path,c.method]),[['user','GET'],['user','PUT'],['logout?scope=local',undefined]]);
  assert.deepEqual(calls[1].body,{password:'Uji12345'});assert.ok(calls.every(c=>c.token==='synthetic-recovery-token-for-owned-user'));assert.equal(membershipCalls,0);
 }finally{await f.app.close();}
});
test('expired recovery tokens cannot update password and provider errors stay actionable',async()=>{
 const f=await fixture();try{
  let writes=0;
  f.gateway.auth=async(_path,_body,_token,method)=>{if(method==='PUT')writes++;throw new AuthProviderError(401,'invalid_token');};
  const request={method:'POST' as const,url:'/api/auth/password/recover',headers:{authorization:'Bearer synthetic-expired-recovery-token'},payload:{password:'Uji12345'}};
  const expired=await f.app.inject(request);assert.equal(expired.statusCode,401);assert.equal(expired.json().error.code,'RECOVERY_EXPIRED');assert.equal(writes,0);
  f.gateway.auth=async(_path,_body,_token,method)=>{if(method==='GET')return {id:'owned-user'};throw new AuthProviderError(422,'same_password');};
  const same=await f.app.inject(request);assert.equal(same.statusCode,422);assert.equal(same.json().error.code,'SAME_PASSWORD');
 }finally{await f.app.close();}
});

test('signup without email confirmation keeps operational access pending and removes the resend endpoint',async()=>{
 const f=await fixture();try{
  const calls:{path:string;body:any;redirectTo?:string}[]=[];
  f.gateway.auth=async(path:string,body?:any,_token?:string,_method?:string,redirectTo?:string)=>{calls.push({path,body,redirectTo});return {user:{id:'new-user'},access_token:'unused-signup-session'};};
  const signup=await f.app.inject({method:'POST',url:'/api/auth/register',payload:{email:'fixture@example.test',password:'Uji12345',display_name:'Uji'}});
  assert.equal(signup.statusCode,202);assert.equal(calls[0].path,'signup');assert.equal(calls[0].redirectTo,undefined);assert.equal(signup.json().status,'pending');assert.match(signup.json().message,/Silakan masuk/);assert.equal(signup.json().access_token,undefined);
  const resend=await f.app.inject({method:'POST',url:'/api/auth/resend-verification',payload:{email:'fixture@example.test'}});
  assert.notEqual(resend.statusCode,202);assert.equal(calls.length,1);
  f.gateway.auth=async()=>({user:{id:'new-user'}});
  const notConfigured=await f.app.inject({method:'POST',url:'/api/auth/register',payload:{email:'fixture@example.test',password:'Uji12345',display_name:'Uji'}});
  assert.equal(notConfigured.statusCode,503);assert.equal(notConfigured.json().error.code,'EMAIL_CONFIRMATION_CONFIGURED');
 }finally{await f.app.close();}
});

test('signup reports an assigned practice workspace only when the server-owned membership is active',async()=>{
 const f=await fixture();try{
  f.gateway.auth=async()=>({user:{id:'new-user'},access_token:'unused-signup-session'});
  f.gateway.profiles.set('new-user',{user_id:'new-user',organization_id:org,role:'petugas',status:'active',scopes:['latihan-new-user'],display_name:'Uji'});
  const request={method:'POST' as const,url:'/api/auth/register',payload:{email:'fixture@example.test',password:'Uji12345',display_name:'Uji'}};
  const ready=await f.app.inject(request);assert.equal(ready.statusCode,202);assert.equal(ready.json().status,'active');assert.match(ready.json().message,/data contoh Anda sudah siap/);assert.equal(ready.json().access_token,undefined);
  const forged=await f.app.inject({...request,payload:{...request.payload,role:'admin'}});assert.equal(forged.statusCode,422);
  f.gateway.profiles.get('new-user')!.scopes=[];
  const unassigned=await f.app.inject(request);assert.equal(unassigned.json().status,'pending');
 }finally{await f.app.close();}
});

test('Auth client encodes redirect_to on the provider URL without mixing it into user data',async()=>{
 let captured='';const gateway=new SupabaseGateway({url:'https://example.supabase.co',publishableKey:'fixture',gatewaySecret:'x'.repeat(64),organizationId:org},async(url)=>{captured=String(url);return new Response('{}');});
 await gateway.auth('resend',{type:'signup',email:'fixture@example.test'},undefined,'POST','http://localhost:5173/');
 const url=new URL(captured);assert.equal(url.pathname,'/auth/v1/resend');assert.equal(url.searchParams.get('redirect_to'),'http://localhost:5173/');
});

test('provider errors retain safe codes and retry delays without exposing response messages',async()=>{
 const gateway=new SupabaseGateway({url:'https://example.supabase.co',publishableKey:'fixture',gatewaySecret:'x'.repeat(64),organizationId:org},async()=>new Response(JSON.stringify({code:'over_email_send_rate_limit',msg:'private@example.test private-provider-detail'}),{status:429,headers:{'Retry-After':'15'}}));
 await assert.rejects(()=>gateway.auth('signup',{email:'test@example.test',password:'Uji12345'}),(error:unknown)=>{
  assert.ok(error instanceof AuthProviderError);assert.equal(error.status,429);assert.equal(error.code,'over_email_send_rate_limit');assert.equal(error.retryAfterSeconds,15);assert.ok(!error.message.includes('private'));return true;
 });
});
test('email throttling, delivery restrictions and unconfirmed login provide actionable messages',async()=>{
 const f=await fixture();try{
  const cases=[['register','over_email_send_rate_limit',429,'EMAIL_RATE_LIMITED','inbox'],['register','email_address_not_authorized',403,'EMAIL_DELIVERY_RESTRICTED','SMTP'],['login','email_not_confirmed',403,'EMAIL_CONFIRMATION_CONFIGURED','Confirm email']] as const;
  for(const [route,code,status,publicCode,message]of cases){
   f.gateway.auth=async()=>{throw new AuthProviderError(code==='over_email_send_rate_limit'?429:400,code,15);};
   const result=await f.app.inject({method:'POST',url:'/api/auth/'+route,payload:{email:'fixture@example.test',password:'Uji12345',...(route==='register'?{display_name:'Uji'}:{})}});
   assert.equal(result.statusCode,status);assert.equal(result.json().error.code,publicCode);assert.match(result.json().error.message,new RegExp(message,'i'));assert.equal(result.headers['retry-after'],'15');
  }
 }finally{await f.app.close();}
});
test('successful signup is not reported as failed if initial profile provisioning is unavailable',async()=>{
 const f=await fixture();try{
  f.gateway.call=async()=>{throw new Error('temporary profile service failure');};
  const result=await f.app.inject({method:'POST',url:'/api/auth/register',payload:{email:'fixture@example.test',password:'Uji12345',display_name:'Uji'}});
  assert.equal(result.statusCode,202);assert.equal(result.json().status,'pending');assert.match(result.json().message,/Silakan masuk/);
 }finally{await f.app.close();}
});

test('eight-character passwords reach the provider; seven characters are rejected for register, login and change',async()=>{
 const f=await fixture();try{
  const token=f.gateway.identity('password-policy-user');
  const original=f.gateway.auth.bind(f.gateway),calls:{path:string;password:string}[]=[];
  f.gateway.auth=async(path,body,accessToken,method)=>{
   if(path==='signup'||path==='token?grant_type=password'||path==='user'&&method==='PUT')calls.push({path,password:body.password});
   if(path==='token?grant_type=password')return {access_token:token,refresh_token:'synthetic-refresh-token'};
   return original(path,body,accessToken,method);
  };
  for(const route of ['register','login','password']){
   const base=route==='register'?{email:'password-policy@example.test',display_name:'Uji'}:route==='login'?{email:'password-policy@example.test'}:{};
   const headers=route==='password'?{authorization:'Bearer '+token}:{};
   const short=await f.app.inject({method:'POST',url:'/api/auth/'+route,headers,payload:{...base,password:'Uji1234'}});
   assert.equal(short.statusCode,422);assert.equal(calls.length,['register','login','password'].indexOf(route));
   const accepted=await f.app.inject({method:'POST',url:'/api/auth/'+route,headers,payload:{...base,password:'Uji12345'}});
   assert.equal(accepted.statusCode,route==='register'?202:route==='login'?200:204);
  }
  assert.equal(calls.length,3);assert.ok(calls.every(call=>call.password==='Uji12345'));
 }finally{await f.app.close();}
});
test('Supabase mode removes public token exposure and rejects old shared tokens',async()=>{const f=await fixture();try{const h=await f.app.inject('/api/health');assert.equal(h.statusCode,200);assert.equal(h.json().session_token,undefined);assert.equal((await f.app.inject('/api/auth/token')).statusCode,401);assert.equal((await f.app.inject({method:'POST',url:'/api/sessions',headers:{authorization:'Bearer old-shared-token'},payload:{}})).statusCode,401);}finally{await f.app.close();}});
test('register cannot supply role and starts pending without operational access',async()=>{const f=await fixture();try{
 const payload={email:'test@example.org',password:'long-password-fixture',display_name:'User'};
 assert.equal((await f.app.inject({method:'POST',url:'/api/auth/register',payload:{...payload,role:'admin'}})).statusCode,422);
 assert.equal((await f.app.inject({method:'POST',url:'/api/auth/register',payload})).json().status,'pending');
 const token=f.gateway.identity('pending',null,'pending');assert.equal((await f.app.inject({method:'POST',url:'/api/sessions',headers:{authorization:'Bearer '+token},payload:{context_id:'posko-a'}})).statusCode,403);
 assert.equal((await f.app.inject({url:'/api/auth/me',headers:{authorization:'Bearer '+token}})).statusCode,200);
}finally{await f.app.close();}});
test('viewer reads publications only, cannot see batches, events or start model work',async()=>{const f=await fixture();try{const token=f.gateway.identity('reader','viewer'),headers={authorization:'Bearer '+token};assert.equal((await f.app.inject({url:'/api/publications',headers})).statusCode,200);
 for(const url of ['/api/batches/unknown','/api/sessions/unknown/events','/api/admin/users'])assert.equal((await f.app.inject({url,headers})).statusCode,403);
 assert.equal((await f.app.inject({method:'POST',url:'/api/sessions',headers,payload:{context_id:'posko-a'}})).statusCode,403);
}finally{await f.app.close();}});
test('petugas scope and session ownership are enforced for messages, SSE and decisions',async()=>{const f=await fixture();try{
 const token=f.gateway.identity('officer-a'),other=f.gateway.identity('officer-b'),headers={authorization:'Bearer '+token};
 assert.equal((await f.app.inject({method:'POST',url:'/api/sessions',headers,payload:{context_id:'posko-b'}})).statusCode,403);
 const response=await f.app.inject({method:'POST',url:'/api/sessions',headers,payload:{context_id:'posko-a'}});assert.equal(response.statusCode,201);const id=response.json().session_id;
 const batch=await f.repo.createBatch({sessionId:id,requestId:'fixture',contextId:'posko-a',sourceSha256:'hash',sourceLength:1,filteredText:'x',piiSummary:{}});
 for(const item of [{method:'POST',url:`/api/sessions/${id}/messages`,payload:{text:'x',request_id:'evil'}},{method:'GET',url:`/api/sessions/${id}/events?stream=false`},{method:'GET',url:`/api/batches/${batch.batch_id}`},{method:'POST',url:`/api/batches/${batch.batch_id}/decisions`,payload:{}}])assert.equal((await f.app.inject({...item,method:item.method as any,headers:{authorization:'Bearer '+other}})).statusCode,404);
 assert.equal((await f.app.inject({url:`/api/batches/${batch.batch_id}`,headers})).statusCode,200);
 f.gateway.profiles.get('officer-a')!.scopes=[];
 assert.equal((await f.app.inject({url:`/api/batches/${batch.batch_id}`,headers})).statusCode,403);
}finally{await f.app.close();}});
test('logout and disabling an account invalidate previously accepted access tokens',async()=>{const f=await fixture();try{const token=f.gateway.identity('officer'),headers={authorization:'Bearer '+token};assert.equal((await f.app.inject({method:'POST',url:'/api/auth/logout',headers})).statusCode,204);assert.equal((await f.app.inject({url:'/api/auth/me',headers})).statusCode,401);
 const second=f.gateway.identity('disabled');f.gateway.profiles.get('disabled')!.status='disabled';assert.equal((await f.app.inject({url:'/api/contexts',headers:{authorization:'Bearer '+second}})).statusCode,403);
}finally{await f.app.close();}});
test('user-editable metadata never grants admin and signed capability cannot change scope',async()=>{const f=await fixture();try{const token=f.gateway.identity('officer'),headers={authorization:'Bearer '+token};assert.equal((await f.app.inject({url:'/api/admin/users',headers})).statusCode,403);const p=await f.auth.authenticate('Bearer '+token);const capability=f.auth.capability(p,'posko-a','fetch_shelters');assert.equal(f.auth.verifyCapability(capability).context_id,'posko-a');assert.throws(()=>f.auth.verifyCapability(capability.slice(0,-1)+'z'));
 const encoded=Buffer.from(JSON.stringify({...f.auth.verifyCapability(capability),exp:0})).toString('base64url');const expired=encoded+'.'+createHmac('sha256',f.gateway.settings.gatewaySecret).update(encoded).digest('hex');assert.throws(()=>f.auth.verifyCapability(expired));
 assert.equal((await f.app.inject({method:'POST',url:'/api/internal/langflow',headers:{'x-sigap-capability':capability},payload:{action:'admin.users',args:{}}})).statusCode,403);
}finally{await f.app.close();}});
test('gateway signs the exact body and rejects redirects without leaking credentials',async()=>{let sent:any;const gateway=new SupabaseGateway({url:'https://example.supabase.co',publishableKey:'pk',gatewaySecret:'x'.repeat(64),organizationId:org},async(url,init)=>{sent={url,init};return new Response(JSON.stringify({data:true}));});assert.equal(await gateway.call('profile.get',{user_id:'u'}),true);const h=sent.init.headers;assert.equal(h['x-sigap-signature'],createHmac('sha256','x'.repeat(64)).update(h['x-sigap-time']+'\n'+h['x-sigap-nonce']+'\n'+sent.init.body).digest('hex'));assert.equal(sent.init.redirect,'error');assert.equal(sent.init.headers.apikey,undefined);});
test('first admin bootstrap requires the installer email and confirmed Auth email',async()=>{const g=new FakeGateway(),auth=new AuthService(g);g.settings.bootstrapAdminEmail='owner@example.test';const token=g.identity('new-owner',null,'pending');g.profiles.get('new-owner')!.organization_id=null;
 g.userOverrides.set('new-owner',{email:'other@example.test',email_confirmed_at:new Date().toISOString()});assert.equal((await auth.authenticate('Bearer '+token)).membership.status,'pending');
 g.userOverrides.set('new-owner',{email:'owner@example.test'});assert.equal((await auth.authenticate('Bearer '+token)).membership.status,'pending');
 g.userOverrides.set('new-owner',{email:'owner@example.test',email_confirmed_at:new Date().toISOString()});assert.equal((await auth.authenticate('Bearer '+token)).membership.role,'admin');
 g.profiles.get('new-owner')!.status='disabled';assert.equal((await auth.authenticate('Bearer '+token)).membership.status,'disabled','bootstrap cannot reactivate a disabled admin');
});
test('approval records use the verified user, never a body-supplied actor',async()=>{const f=await fixture();try{const token=f.gateway.identity('officer'),headers={authorization:'Bearer '+token};const s=(await f.app.inject({method:'POST',url:'/api/sessions',headers,payload:{context_id:'posko-a'}})).json();
 const b=await f.repo.createBatch({sessionId:s.session_id,requestId:'approve',contextId:'posko-a',sourceSha256:'h',sourceLength:1,filteredText:'x',piiSummary:{}});const ref='a'.repeat(32);await f.repo.saveSnapshot({snapshotId:ref,snapshotSha256:'b'.repeat(64),batchId:b.batch_id,version:1,qualityStatus:'OK',payload:{records:[]}});
 const res=await f.app.inject({method:'POST',url:`/api/batches/${b.batch_id}/decisions`,headers,payload:{action:'approve_save',snapshot_id:ref,partial_acknowledged:false,clear_decisions:{},actor_id:'forged-admin'}});assert.equal(res.statusCode,202);const saved=f.gateway.entities.get('approvals:'+res.json().approval_id);assert.equal(saved.actor_id,'officer');
}finally{await f.app.close();}});

test('command onboarding uses the configured organization and authenticated actor, never body-supplied privileges',async()=>{
 const f=await fixture();try{
  const token=f.gateway.identity('new-member',null,'pending'),headers={authorization:'Bearer '+token};
  const calls:{action:string;args:any}[]=[];const original=f.gateway.call.bind(f.gateway);
  f.gateway.call=async(action,args:any={})=>{if(action==='command.info'||action.startsWith('membership.')){calls.push({action,args});return {status:'pending'} as any;}return original(action,args);};
  assert.equal((await f.app.inject({url:'/api/auth/command',headers})).statusCode,200);
  assert.equal(calls[0].args.organization_id,org);
  assert.equal((await f.app.inject({method:'POST',url:'/api/auth/join-requests',headers,payload:{note:'Petugas relawan'}})).statusCode,202);
  assert.deepEqual(calls[1],{action:'membership.request',args:{actor_id:'new-member',organization_id:org,note:'Petugas relawan'}});
  for(const extra of [{role:'admin'},{organization_id:'another-command'},{actor_id:'someone-else'}])
   assert.equal((await f.app.inject({method:'POST',url:'/api/auth/join-requests',headers,payload:extra})).statusCode,422);
  assert.equal((await f.app.inject({url:'/api/contexts',headers})).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/auth/command'})).statusCode,401);
 }finally{await f.app.close();}
});

test('invitation token is random, returned once with no-store, and only its hash reaches storage',async()=>{
 const f=await fixture();try{
  const admin=f.gateway.identity('command-admin','admin'),headers={authorization:'Bearer '+admin};
  const calls:{action:string;args:any}[]=[];const original=f.gateway.call.bind(f.gateway);
  f.gateway.call=async(action,args:any={})=>{if(action.startsWith('admin.invitation')||action==='membership.accept'){calls.push({action,args});return {id:'invitation-id',email:args.email} as any;}return original(action,args);};
  const response=await f.app.inject({method:'POST',url:'/api/admin/invitations',headers,payload:{email:'Officer@Example.org',role:'petugas',scopes:['posko-a','posko-a']}});
  assert.equal(response.statusCode,201);assert.equal(response.headers['cache-control'],'no-store');
  const token=response.json().token;assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(calls[0].args.email,'officer@example.org');assert.deepEqual(calls[0].args.scopes,['posko-a']);
  assert.equal(calls[0].args.token_hash,createHash('sha256').update(token).digest('hex'));assert(!JSON.stringify(calls[0]).includes(token));
  const member=f.gateway.identity('invitee',null,'pending');
  const accepted=await f.app.inject({method:'POST',url:'/api/auth/invitations/accept',headers:{authorization:'Bearer '+member},payload:{token}});
  assert.equal(accepted.statusCode,200);assert.equal(calls[1].args.actor_id,'invitee');assert.equal(calls[1].args.organization_id,org);assert.equal(calls[1].args.token_hash,calls[0].args.token_hash);
  assert.equal((await f.app.inject({method:'POST',url:'/api/auth/invitations/accept',headers:{authorization:'Bearer '+member},payload:{token,role:'admin'}})).statusCode,422);
 }finally{await f.app.close();}
});

test('only an active command admin can manage invitations, applicants and operation spaces',async()=>{
 const f=await fixture();try{
  for(const role of ['petugas','viewer'] as const){const token=f.gateway.identity(role,role),headers={authorization:'Bearer '+token};
   for(const url of ['/api/admin/command','/api/admin/invitations','/api/admin/join-requests'])assert.equal((await f.app.inject({url,headers})).statusCode,403);
   assert.equal((await f.app.inject({method:'POST',url:'/api/admin/operations',headers,payload:{context_id:'banjir',name:'Banjir'}})).statusCode,403);
  }
  const token=f.gateway.identity('disabled-admin','admin','disabled');assert.equal((await f.app.inject({url:'/api/admin/command',headers:{authorization:'Bearer '+token}})).statusCode,403);
 }finally{await f.app.close();}
});

test('operation selection checks assignment and does not mutate another tab or session',async()=>{
 const f=await fixture();try{
  const token=f.gateway.identity('officer'),headers={authorization:'Bearer '+token};const original=f.gateway.call.bind(f.gateway);
  f.gateway.call=async(action,args:any={})=>action==='context.get'?{context_id:args.context_id,organization_id:org,name:'Operasi A'} as any:original(action,args);
  const selected=await f.app.inject({url:'/api/contexts/posko-a',headers});assert.equal(selected.statusCode,200);assert.equal(selected.json().context_id,'posko-a');
  assert.equal((await f.app.inject({url:'/api/contexts/posko-b',headers})).statusCode,403);
  assert.deepEqual(f.gateway.profiles.get('officer')!.scopes,['posko-a']);assert.equal(f.gateway.entities.size,0);
 }finally{await f.app.close();}
});

test('join decisions bind the administrator identity and require an explicit approved assignment',async()=>{
 const f=await fixture();try{
  const token=f.gateway.identity('admin','admin'),headers={authorization:'Bearer '+token};let decision:any;const original=f.gateway.call.bind(f.gateway);
  f.gateway.call=async(action,args:any={})=>{if(action==='admin.request.decide'){decision=args;return {status:'approved'} as any;}return original(action,args);};
  const url='/api/admin/join-requests/10000000-0000-4000-8000-000000000001/decision';
  assert.equal((await f.app.inject({method:'POST',url,headers,payload:{decision:'approve'}})).statusCode,422);
  assert.equal((await f.app.inject({method:'POST',url,headers,payload:{decision:'approve',role:'petugas',scopes:['posko-a'],actor_id:'forged'}})).statusCode,422);
  assert.equal((await f.app.inject({method:'POST',url,headers,payload:{decision:'approve',role:'petugas',scopes:['posko-a']}})).statusCode,200);
  assert.equal(decision.actor_id,'admin');assert.equal(decision.role,'petugas');
 }finally{await f.app.close();}
});
