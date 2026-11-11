import {createHmac,randomUUID} from 'node:crypto';

const key=process.env.LOCAL_ANON_KEY, password=process.env.LOCAL_ADMIN_PASSWORD;
const secret=process.env.SIGAP_SUPABASE_GATEWAY_SECRET,mcpKey=process.env.LANGFLOW_API_KEY;
if(!key||!password||!secret||!mcpKey)throw Error('Local verification credentials missing');
async function request(url,options={}){
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!response.ok)throw Error(`Local readiness request failed (${response.status})`);
 return response;
}
const login=await (await request('http://backend:8787/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@sigap.local',password})})).json();
if(!login.access_token||login.profile?.role!=='admin')throw Error('Local admin login failed');
const claims=JSON.parse(Buffer.from(login.access_token.split('.')[1],'base64url').toString('utf8'));
const contexts=await (await request('http://backend:8787/api/contexts',{headers:{Authorization:'Bearer '+login.access_token}})).json();
if(!Array.isArray(contexts)||!contexts.some(row=>row.context_id==='posko-default'))throw Error('Local context missing');
const body=JSON.stringify({action:'storage.read',args:{actor_id:claims.sub,context_id:'posko-default'}}),stamp=String(Date.now()),nonce=randomUUID();
const signature=createHmac('sha256',secret).update(stamp+'\n'+nonce+'\n'+body).digest('hex');
const stored=(await (await request('http://api-gw:8000/functions/v1/sigap-backend',{method:'POST',headers:{'Content-Type':'application/json','x-sigap-time':stamp,'x-sigap-nonce':nonce,'x-sigap-signature':signature},body})).json()).data;
const index=stored?.document?.header?.indexOf('jumlah_jiwa');
if(index<0||stored?.document?.rows?.length!==8||stored.document.rows.reduce((sum,row)=>sum+Number(row[index]),0)!==630)throw Error('Synthetic local data is incomplete');

const endpoint='http://langflow:10000/mcp',headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream','x-api-key':mcpKey};
async function rpc(payload){
 const response=await request(endpoint,{method:'POST',headers,body:JSON.stringify(payload)});
 const session=response.headers.get('mcp-session-id');if(session)headers['mcp-session-id']=session;
 const text=await response.text();
 if(!payload.id)return null;
 let data;
 if((response.headers.get('content-type')||'').includes('text/event-stream')){
  const line=text.split(/\r?\n/).find(item=>item.startsWith('data:'));
  data=JSON.parse(line.slice(5).trim());
 }else data=JSON.parse(text);
 if(data.id!==payload.id||data.error||!data.result)throw Error('MCP verification failed');
 return data.result;
}
const init=await rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'sigap-local-check',version:'1'}}});
headers['mcp-protocol-version']=init.protocolVersion;
await rpc({jsonrpc:'2.0',method:'notifications/initialized'});
const tools=await rpc({jsonrpc:'2.0',id:2,method:'tools/list'});
const actual=tools.tools.map(item=>item.name.replace(/^sigap_\d+_/,''));
const expected=['fetch_shelters','prepare_needs','validate_needs','calculate_gap','flag_anomalies','upsert_shelter','draft_bulletin'];
if(actual.length!==expected.length||expected.some(name=>!actual.includes(name)))throw Error('SIGAP MCP tools incomplete');
if(headers['mcp-session-id'])await fetch(endpoint,{method:'DELETE',headers,signal:AbortSignal.timeout(5000)}).catch(()=>{});
await request('http://backend:8787/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+login.access_token}});
for(const [role,passwordKey] of [['petugas','LOCAL_OFFICER_PASSWORD'],['viewer','LOCAL_VIEWER_PASSWORD']]){
 const roleLogin=await (await request('http://backend:8787/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:role+'@sigap.local',password:process.env[passwordKey]})})).json();
 if(!roleLogin.access_token||roleLogin.profile?.role!==role)throw Error('Local '+role+' login failed');
 const roleHeaders={Authorization:'Bearer '+roleLogin.access_token};
 if(role==='petugas'){
  const roleContexts=await (await request('http://backend:8787/api/contexts',{headers:roleHeaders})).json();
  if(!roleContexts.some(row=>row.context_id==='posko-default')||roleContexts.some(row=>row.context_id==='posko-latihan'))throw Error('Local petugas scope is incorrect');
 }else{
  const denied=await fetch('http://backend:8787/api/contexts',{headers:roleHeaders,signal:AbortSignal.timeout(10000)});
  if(denied.status!==403)throw Error('Local viewer can access officer workspaces');
  await request('http://backend:8787/api/publications',{headers:roleHeaders});
 }
 await request('http://backend:8787/api/auth/logout',{method:'POST',headers:roleHeaders});
}
const unsigned=await fetch('http://api-gw:8000/functions/v1/sigap-backend',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
if(unsigned.status!==401)throw Error('Unsigned local gateway request was not denied');
const unauthorized=await fetch('http://api-gw:8000/rest/v1/rpc/sigap_local_seeded',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
if(unauthorized.ok)throw Error('Anonymous local seed access was not denied');
console.log('Login tiga peran, ruang kerja, delapan posko sintetis, batas akses gateway dan tujuh tool MCP siap. Watsonx perlu koneksi internet.');
