import {readFileSync} from 'node:fs';

const base='http://api-gw:8000',key=process.env.LOCAL_SERVICE_ROLE_KEY,org=process.env.SIGAP_ORGANIZATION_ID;
if(!key||!org)throw Error('Local service configuration missing');
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function request(path,options={}){
 const response=await fetch(base+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw Error(`Local setup request failed (${response.status})`);
 return response.status===204?null:response.json();
}
const rpc=(name,body)=>request('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(body)});
let initialized;
for(let attempt=0;attempt<30;attempt++){
 try{initialized=await rpc('sigap_local_seeded',{});break;}
 catch(error){if(attempt===29)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}
}
if(initialized){console.log('SIGAP local data already initialized.');process.exit(0);}
const accounts=[['admin','admin@sigap.local','LOCAL_ADMIN_PASSWORD'],['petugas','petugas@sigap.local','LOCAL_OFFICER_PASSWORD'],['viewer','viewer@sigap.local','LOCAL_VIEWER_PASSWORD']];
const listed=await request('/auth/v1/admin/users?page=1&per_page=1000');
const users=Array.isArray(listed)?listed:listed.users;
if(!Array.isArray(users))throw Error('Could not inspect local users');
const ids={};
for(const [role,email,passwordKey] of accounts){
 const password=process.env[passwordKey];if(!password||password.length<16)throw Error('Local account password missing');
 let user=users.find(item=>item.email?.toLowerCase()===email);
 if(user&&user.app_metadata?.sigap_local_installation!==org)throw Error('A conflicting local demo account exists');
 if(!user)user=await request('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password,email_confirm:true,app_metadata:{sigap_local_installation:org}})});
 if(!user?.id)throw Error('Local account creation failed');
 ids[role]=user.id;
}
const document=JSON.parse(readFileSync('/sigap/seed-storage.json','utf8'));
await rpc('sigap_local_seed',{p_org:org,p_users:ids,p_document:document});
if(!await rpc('sigap_local_seeded',{}))throw Error('Local seed was not confirmed');
console.log('SIGAP local demo accounts and eight synthetic shelters ready.');
