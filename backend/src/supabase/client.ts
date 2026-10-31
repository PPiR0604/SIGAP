import {createHmac,randomUUID} from 'node:crypto';
export interface SupabaseSettings {url:string;publishableKey:string;gatewaySecret:string;organizationId:string;bootstrapAdminEmail?:string}
export class GatewayRejectedError extends Error {
 constructor(){super('Supabase menolak operasi backend.');}
}
export class AuthProviderError extends Error {
 constructor(readonly status:number,readonly code:string,readonly retryAfterSeconds?:number){super('Layanan autentikasi menolak permintaan.');}
}
export class SupabaseGateway {
 constructor(readonly settings:SupabaseSettings,private request:typeof fetch=fetch){}
 async call<T=any>(action:string,args:Record<string,unknown>={}):Promise<T>{
  const body=JSON.stringify({action,args}),stamp=String(Date.now()),nonce=randomUUID();
  const signature=createHmac('sha256',this.settings.gatewaySecret).update(stamp+'\n'+nonce+'\n'+body).digest('hex');
  const res=await this.request(this.settings.url+'/functions/v1/sigap-backend',{method:'POST',headers:{'Content-Type':'application/json','x-sigap-time':stamp,'x-sigap-nonce':nonce,'x-sigap-signature':signature},body,signal:AbortSignal.timeout(action.startsWith('migration.')?120000:30000),redirect:'error'});
  if(!res.ok){if(res.status===400)throw new GatewayRejectedError();throw new Error('Supabase tidak tersedia.');}
  return (await res.json() as {data:T}).data;
 }
 async auth(path:string,body?:unknown,token?:string,method=body===undefined?'GET':'POST',redirectTo?:string):Promise<any>{
  const url=new URL(this.settings.url+'/auth/v1/'+path);if(redirectTo)url.searchParams.set('redirect_to',redirectTo);
  const res=await this.request(url.toString(),{method,headers:{apikey:this.settings.publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!res.ok){
   const body=await res.json().catch(()=>({})) as {code?:unknown;error_code?:unknown};
   const candidate=body.code??body.error_code;
   const code=typeof candidate==='string'&&/^[a-z0-9_]{1,80}$/.test(candidate)?candidate:'auth_request_failed';
   const seconds=Number(res.headers.get('retry-after'));
   throw new AuthProviderError(res.status,code,Number.isInteger(seconds)&&seconds>0&&seconds<=86400?seconds:undefined);
  }
  return res.status===204?{}:res.json();
 }
}
