import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';

const envFile='.env.sigap-local',accountsFile='.sigap-local-accounts.txt';
if(existsSync(envFile)||existsSync(accountsFile))throw Error('Konfigurasi atau akun lokal sudah ada; file yang ada tidak ditimpa.');
const random=()=>randomBytes(32).toString('hex');
function jwt(role,secret){
 const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const body=part({alg:'HS256',typ:'JWT'})+'.'+part({iss:'supabase',role,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+10*365*86400});
 return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
}
async function hidden(prompt){
 if(!stdin.isTTY)throw Error('Setup interaktif memerlukan terminal.');
 stdout.write(prompt);stdin.setRawMode(true);stdin.resume();let value='';
 try{return await new Promise((resolve,reject)=>{
  const onData=buffer=>{
   const text=buffer.toString('utf8');
   for(const char of text){
    if(char==='\u0003'){stdin.off('data',onData);reject(Error('Setup dibatalkan.'));return;}
    if(char==='\r'||char==='\n'){stdin.off('data',onData);stdout.write('\n');resolve(value);return;}
    if(char==='\u007f'||char==='\b')value=value.slice(0,-1);
    else if(char>=' '&&char!=='\u001b')value+=char;
   }
  };stdin.on('data',onData);
 });}finally{stdin.setRawMode(false);stdin.pause();}
}
let apiKey,projectId,baseUrl;
if(process.argv.includes('--from-environment')){
 apiKey=process.env.SIGAP_WATSONX_API_KEY;projectId=process.env.SIGAP_WATSONX_PROJECT_ID;baseUrl=process.env.SIGAP_WATSONX_URL;
}else{
 const rl=createInterface({input:stdin,output:stdout});
 projectId=(await rl.question('Project ID watsonx: ')).trim();
 baseUrl=(await rl.question('URL watsonx [https://us-south.ml.cloud.ibm.com]: ')).trim()||'https://us-south.ml.cloud.ibm.com';
 rl.close();apiKey=await hidden('API key watsonx (tidak ditampilkan): ');
}
let parsed;try{parsed=new URL(baseUrl||'');}catch{throw Error('URL watsonx tidak valid.');}
if(parsed.protocol!=='https:'||!/^[a-z0-9-]+\.ml\.cloud\.ibm\.com$/.test(parsed.hostname)||parsed.port||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('Gunakan URL regional watsonx IBM Cloud HTTPS.');
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(projectId||''))throw Error('Project ID watsonx tidak valid.');
if(!/^[A-Za-z0-9_-]{16,}$/.test(apiKey||''))throw Error('API key watsonx tidak valid.');
const jwtSecret=random(),organization=randomUUID();
const config={
 LOCAL_POSTGRES_PASSWORD:random(),LOCAL_JWT_SECRET:jwtSecret,
 LOCAL_ANON_KEY:jwt('anon',jwtSecret),LOCAL_SERVICE_ROLE_KEY:jwt('service_role',jwtSecret),
 SIGAP_SUPABASE_GATEWAY_SECRET:random(),SIGAP_ORGANIZATION_ID:organization,
 LANGFLOW_API_KEY:random(),LANGFLOW_SECRET_KEY:random(),LANGFLOW_SUPERUSER_PASSWORD:random(),
 LOCAL_ADMIN_PASSWORD:randomBytes(18).toString('base64url'),LOCAL_OFFICER_PASSWORD:randomBytes(18).toString('base64url'),LOCAL_VIEWER_PASSWORD:randomBytes(18).toString('base64url'),
 SIGAP_WATSONX_URL:parsed.origin,SIGAP_WATSONX_PROJECT_ID:projectId,SIGAP_WATSONX_API_KEY:apiKey,SIGAP_WATSONX_MODEL:'openai/gpt-oss-120b',
};
// Docker env-file interpolation must not expand characters from credentials.
const escape=value=>"'"+String(value)+"'";
const env=Object.entries(config).map(([name,value])=>name+'='+escape(value)).join('\n')+'\n';
const accounts=`Akun SIGAP lokal (simpan hanya pada komputer demo)\nAdmin: admin@sigap.local / ${config.LOCAL_ADMIN_PASSWORD}\nPetugas: petugas@sigap.local / ${config.LOCAL_OFFICER_PASSWORD}\nViewer: viewer@sigap.local / ${config.LOCAL_VIEWER_PASSWORD}\n`;
writeFileSync(accountsFile,accounts,{flag:'wx',mode:0o600});
writeFileSync(envFile,env,{flag:'wx',mode:0o600});
console.log(`Konfigurasi lokal dibuat. Akun demo tersedia di ${accountsFile}.`);
