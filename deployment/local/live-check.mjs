// Opt-in live test: uses Watsonx and creates one synthetic, unapproved training report.
import {randomUUID} from 'node:crypto';
process.loadEnvFile('.env.sigap-local');
const base='http://localhost:8080',password=process.env.LOCAL_ADMIN_PASSWORD;
if(!password)throw Error('Konfigurasi lokal tidak ditemukan.');
let token;
async function request(path,options={}){
 const response=await fetch(base+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...options.headers},signal:AbortSignal.timeout(30000)});
 const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{data=null;}
 return {status:response.status,data};
}
try{
 const login=await request('/api/auth/login',{method:'POST',body:JSON.stringify({email:'admin@sigap.local',password})});
 if(login.status!==200||!login.data?.access_token)throw Error('Login uji gagal.');
 token=login.data.access_token;
 const created=await request('/api/sessions',{method:'POST',body:JSON.stringify({context_id:'posko-latihan',resume:false})});
 if(created.status!==201||!created.data?.session_id)throw Error('Sesi latihan gagal dibuat.');
 const path='/api/sessions/'+created.data.session_id+'/messages',requestId=randomUUID();
 const body={request_id:requestId,text:'Laporan sintetis pengujian: Posko Latihan Melati, Desa Maju. Jumlah pengungsi 12 jiwa, laki-laki 5, perempuan 7. Stok air bersih 100 liter dan pangan 20 kilogram. Mohon periksa laporan ini.'};
 const start=Date.now(),first=await request(path,{method:'POST',body:JSON.stringify(body)});
 if(first.status!==202||!first.data?.batch_id)throw Error('Pengiriman laporan uji gagal ('+first.status+').');
 const replay=await request(path,{method:'POST',body:JSON.stringify(body)});
 if(replay.status!==200||replay.data?.batch_id!==first.data.batch_id)throw Error('Pengiriman ulang identik tidak dikenali.');
 const conflict=await request(path,{method:'POST',body:JSON.stringify({...body,text:body.text+' Perubahan.'})});
 if(conflict.status!==409)throw Error('Pengiriman ulang dengan isi berbeda tidak ditolak.');
 console.log('Pengiriman ganda terdeteksi dan perubahan dengan identitas sama ditolak.');
 let last;
 while(Date.now()-start<240000){
  const result=await request('/api/batches/'+first.data.batch_id);
  if(result.status!==200)throw Error('Status laporan uji tidak dapat dibaca.');
  last=result.data;
  if(['ready_for_review','failed','rejected','save_status_unknown','completed'].includes(last.status))break;
  await new Promise(resolve=>setTimeout(resolve,3000));
 }
 console.log(JSON.stringify({status:last?.status,quality:last?.quality_status,preview:!!last?.preview,elapsed_seconds:Math.round((Date.now()-start)/1000)}));
 if(last?.status!=='ready_for_review'||!last.preview)throw Error('Laporan uji belum mencapai tahap pemeriksaan petugas.');
}finally{
 if(token)await request('/api/auth/logout',{method:'POST',body:'{}'}).catch(()=>{});
}
