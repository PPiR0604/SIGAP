// Edge-only service key. No dependency imports or user-controlled SQL.
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function rpc(name:string,args:unknown){
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const res=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args)});
 if(!res.ok)throw new Error('DATABASE_REJECTED');return res.json();
}
Deno.serve(async(req:Request)=>{
 try{
  if(req.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(Number(req.headers.get('content-length')||0)>32*1024*1024)return reply(413,{error:'TOO_LARGE'});
  const raw=await req.text();if(raw.length>32*1024*1024)return reply(413,{error:'TOO_LARGE'});
  const stamp=req.headers.get('x-sigap-time')||'',nonce=req.headers.get('x-sigap-nonce')||'',signature=req.headers.get('x-sigap-signature')||'';
  if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>60000||!/^[a-f0-9-]{36}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(signature))return reply(401,{error:'UNAUTHORIZED'});
  const secret=await rpc('sigap_gateway_secret',{});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const sig=new Uint8Array(signature.match(/../g)!.map(x=>parseInt(x,16)));
  if(!await crypto.subtle.verify('HMAC',key,sig,new TextEncoder().encode(stamp+'\n'+nonce+'\n'+raw)))return reply(401,{error:'UNAUTHORIZED'});
  if(!await rpc('sigap_gateway_nonce',{p_nonce:nonce}))return reply(401,{error:'REPLAY_REJECTED'});
  const body=JSON.parse(raw);
  return reply(200,{data:await rpc('sigap_dispatch',{p_action:body.action,p_args:body.args})});
 }catch{return reply(400,{error:'REQUEST_REJECTED'});}
});
