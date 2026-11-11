// Opt-in live integration check of stored synthetic data and Langflow calculation.
process.loadEnvFile('.env.sigap-local');
const base='http://localhost:8080';let token;
async function call(path,options={}){
 const response=await fetch(base+path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw Error('Local integration request failed ('+response.status+').');
 return response.status===204?null:response.json();
}
try{
 const login=await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:'admin@sigap.local',password:process.env.LOCAL_ADMIN_PASSWORD})});token=login.access_token;
 const session=await call('/api/sessions',{method:'POST',body:JSON.stringify({context_id:'posko-default',resume:true})});
 const overview=await call('/api/sessions/'+session.session_id+'/overview');
 const totalPeople=overview.records?.reduce((sum,row)=>sum+Number(row.total_people||0),0);
 const water=overview.calculation?.totals?.air_liter_per_hari;
 console.log(JSON.stringify({status:overview.status,records:overview.records?.length,totalPeople,waterLitersPerDay:water}));
 if(overview.status!=='ready'||overview.records?.length!==8||totalPeople!==630||water!==9450)throw Error('Local stored-data calculation is incomplete.');
}finally{if(token)await call('/api/auth/logout',{method:'POST'}).catch(()=>{});}
