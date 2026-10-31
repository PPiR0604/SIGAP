import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {AuthService,AccessError} from '../auth/service.js';
import {createHash} from 'node:crypto';
import {AuthProviderError} from '../supabase/client.js';
import {logger} from '../logging.js';
const credentials=z.object({email:z.string().email().max(254),password:z.string().min(8).max(128)}).strict();
const token=z.object({refresh_token:z.string().min(10).max(8192)}).strict();
function providerFailure(error:unknown,reply:any){
 if(!(error instanceof AuthProviderError))return false;
 const known:Record<string,[number,string,string]>={
  over_email_send_rate_limit:[429,'EMAIL_RATE_LIMITED','Batas pengiriman email sedang tercapai. Periksa inbox dan spam untuk tautan terbaru, lalu tunggu sebelum meminta tautan baru.'],
  over_request_rate_limit:[429,'AUTH_RATE_LIMITED','Terlalu banyak permintaan autentikasi. Tunggu sebentar sebelum mencoba lagi.'],
  email_not_confirmed:[403,'EMAIL_CONFIRMATION_CONFIGURED','Pengaturan login proyek masih meminta konfirmasi email. Hubungi admin untuk menonaktifkan Confirm email di Supabase.'],
  email_address_invalid:[422,'INVALID_EMAIL','Alamat email tidak diterima penyedia autentikasi. Periksa kembali format alamat email Anda.'],
  email_address_not_authorized:[403,'EMAIL_DELIVERY_RESTRICTED','Layanan email proyek belum diizinkan mengirim ke alamat ini. Admin perlu mengonfigurasi SMTP untuk mengirim email verifikasi.'],
  weak_password:[422,'WEAK_PASSWORD','Password ditolak penyedia autentikasi. Gunakan minimal 8 karakter dan hindari password yang mudah ditebak.'],
  same_password:[422,'SAME_PASSWORD','Gunakan kata sandi baru yang berbeda dari kata sandi sebelumnya.'],
  signup_disabled:[403,'SIGNUP_DISABLED','Pendaftaran akun sedang dinonaktifkan oleh admin.'],
  email_provider_disabled:[403,'EMAIL_PROVIDER_DISABLED','Login email belum diaktifkan di layanan autentikasi. Hubungi admin.'],
 };
 const issue=known[error.code]||(error.status===429?[429,'AUTH_RATE_LIMITED','Terlalu banyak permintaan autentikasi. Tunggu sebentar sebelum mencoba lagi.']:error.status>=500?[503,'AUTH_UNAVAILABLE','Layanan autentikasi belum tersedia. Coba lagi sebentar.']:null);
 if(!issue)return false;
 if(error.retryAfterSeconds)reply.header('Retry-After',String(error.retryAfterSeconds));
 reply.code(issue[0]).send({error:{code:issue[1],message:issue[2],...(error.retryAfterSeconds?{retry_after_seconds:error.retryAfterSeconds}:{})}});return true;
}
export function createAuthRoutes(auth:AuthService,redirectUrl='http://localhost:5173/'):FastifyPluginAsync{return async app=>{
 const attempts=new Map<string,{count:number;until:number}>();
 app.addHook('preHandler',async(req,reply)=>{reply.header('Cache-Control','no-store');if(req.method!=='POST')return;
  const key=req.ip+':'+req.routeOptions.url;const stamp=Date.now();for(const [k,v]of attempts)if(v.until<stamp)attempts.delete(k);
  if(attempts.size>10000)return reply.code(429).header('Retry-After','60').send({error:{code:'RATE_LIMITED',message:'Terlalu banyak permintaan. Tunggu satu menit sebelum mencoba lagi.'}});
  const a=attempts.get(key)??{count:0,until:stamp+60000};attempts.set(key,a);if(++a.count>10)return reply.code(429).header('Retry-After',String(Math.max(1,Math.ceil((a.until-stamp)/1000)))).send({error:{code:'RATE_LIMITED',message:'Terlalu banyak permintaan. Tunggu satu menit sebelum mencoba lagi.'}});
 });
 app.post('/api/auth/register',async(req,reply)=>{const body=credentials.extend({display_name:z.string().trim().min(1).max(120)}).safeParse(req.body);if(!body.success)return reply.code(422).send({error:{code:'INVALID_REGISTRATION'}});
  try{const result=await auth.gateway.auth('signup',{email:body.data.email,password:body.data.password,data:{display_name:body.data.display_name}});
   if(!result.access_token)return reply.code(503).send({error:{code:'EMAIL_CONFIRMATION_CONFIGURED',message:'Pendaftaran belum dapat dilanjutkan tanpa email. Admin perlu menonaktifkan Confirm email di Supabase.'}});
   let profile: {status?:string;role?:string;scopes?:string[]}|undefined;
   if(result.user?.id){try{profile=await auth.gateway.call('profile.ensure',{user_id:result.user.id,display_name:body.data.display_name});}catch{logger.warn('Profil akun akan disiapkan kembali saat login.',{code:'PROFILE_PROVISIONING_DELAYED'});}}
   const ready=profile?.status==='active'&&profile.role==='petugas'&&Array.isArray(profile.scopes)&&profile.scopes.length>0;
   return reply.code(202).send(ready
    ? {status:'active',message:'Pendaftaran berhasil. Silakan masuk; ruang latihan dan data contoh Anda sudah siap.'}
    : {status:'pending',message:'Pendaftaran berhasil. Silakan masuk dengan email dan kata sandi Anda, lalu minta akses ruang kerja kepada admin.'});
  }catch(error){if(providerFailure(error,reply))return;return reply.code(400).send({error:{code:'REGISTRATION_REJECTED',message:'Pendaftaran belum berhasil. Periksa alamat email dan password, lalu coba kembali.'}});}});
 app.post('/api/auth/login',async(req,reply)=>{const body=credentials.safeParse(req.body);if(!body.success)return reply.code(422).send({error:{code:'INVALID_CREDENTIALS'}});try{const session=await auth.gateway.auth('token?grant_type=password',body.data);const principal=await auth.authenticate('Bearer '+session.access_token);if(principal.membership.status==='disabled')throw new Error();return reply.send({...session,profile:principal.membership});}catch(error){if(providerFailure(error,reply))return;return reply.code(401).send({error:{code:'LOGIN_REJECTED',message:'Email/password tidak valid atau akun belum dapat login.'}});}});
 app.post('/api/auth/refresh',async(req,reply)=>{const body=token.safeParse(req.body);if(!body.success)return reply.code(422).send({error:{code:'INVALID_REFRESH'}});try{const session=await auth.gateway.auth('token?grant_type=refresh_token',body.data);const p=await auth.authenticate('Bearer '+session.access_token);if(p.membership.status==='disabled')throw new Error();return reply.send({...session,profile:p.membership});}catch{return reply.code(401).send({error:{code:'REFRESH_REJECTED'}});}});
 app.get('/api/auth/me',async req=>({profile:req.principal!.membership}));
 app.post('/api/auth/logout',async(req,reply)=>{const p=req.principal!;await auth.gateway.call('session.revoke',{session_id:p.sessionId});try{await auth.gateway.auth('logout?scope=local',{},p.token);}catch{/* Local session revocation already takes effect. */}return reply.code(204).send();});
 app.post('/api/auth/password/reset',async(req,reply)=>{
  const body=z.object({email:z.string().email().max(254)}).strict().safeParse(req.body);
  if(!body.success)return reply.code(422).send({error:{code:'INVALID_EMAIL',message:'Masukkan email yang digunakan saat mendaftar.'}});
  const target=new URL(redirectUrl);target.searchParams.set('auth','recovery');
  try{await auth.gateway.auth('recover',body.data,undefined,'POST',target.toString());}
  catch(error){if(error instanceof AuthProviderError&&error.code==='user_not_found'){/* Same public response to avoid enumeration. */}else if(providerFailure(error,reply))return;else return reply.code(503).send({error:{code:'RECOVERY_UNAVAILABLE',message:'Permintaan pemulihan belum dapat dikirim. Coba lagi sebentar.'}});}
  return reply.code(202).send({message:'Permintaan pemulihan diterima. Jika akun terdaftar dan email dapat dikirim, buka tautan terbaru di inbox atau spam. Ini belum memastikan email terkirim.'});
 });
 app.post('/api/auth/password/recover',async(req,reply)=>{
  const body=z.object({password:z.string().min(8).max(128)}).strict().safeParse(req.body);
  if(!body.success)return reply.code(422).send({error:{code:'INVALID_PASSWORD',message:'Kata sandi baru perlu minimal 8 karakter.'}});
  const bearer=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9._-]{20,8192})$/)?.[1];
  if(!bearer)return reply.code(401).send({error:{code:'RECOVERY_EXPIRED',message:'Buka tautan pemulihan terbaru dari email terlebih dahulu.'}});
  try{
   // Supabase validates ownership; this route never creates an app session or grants membership.
   const user=await auth.gateway.auth('user',undefined,bearer,'GET');
   if(!user?.id)throw new AuthProviderError(401,'invalid_token');
   await auth.gateway.auth('user',body.data,bearer,'PUT');
   try{await auth.gateway.auth('logout?scope=local',{},bearer);}catch{/* Password update already succeeded. */}
   return reply.code(204).send();
  }catch(error){
   if(error instanceof AuthProviderError&&[401,403].includes(error.status))return reply.code(401).send({error:{code:'RECOVERY_EXPIRED',message:'Tautan pemulihan sudah tidak berlaku. Minta tautan baru lalu coba lagi.'}});
   if(providerFailure(error,reply))return;
   return reply.code(503).send({error:{code:'RECOVERY_UNAVAILABLE',message:'Kata sandi belum dapat diperbarui. Coba lagi sebentar.'}});
  }
 });
 app.post('/api/auth/password',async(req,reply)=>{const body=z.object({password:z.string().min(8).max(128)}).strict().safeParse(req.body);if(!body.success)return reply.code(422).send({error:{code:'INVALID_PASSWORD'}});await auth.gateway.auth('user',body.data,req.principal!.token,'PUT');return reply.code(204).send();});
 app.get('/api/contexts',async req=>auth.gateway.call('contexts',{actor_id:req.principal!.userId}));
 app.get('/api/publications',async req=>{
  const publications=await auth.gateway.call('publications.list',{actor_id:req.principal!.userId});
  return Promise.all(publications.map(async(item:any)=>{if(!item.batch_id)return item;try{const batch=await auth.gateway.call('entity.get',{kind:'batches',id:item.batch_id});if(!batch||batch.context_id!==item.context_id||batch.organization_id&&batch.organization_id!==req.principal!.membership.organization_id)return item;const source=JSON.parse(batch.bulletin_payload_json||'{}').source_metadata;return {...item,context_name:typeof source?.context_name==='string'?source.context_name:undefined};}catch{return item;}}));
 });
 app.get('/api/admin/users',async req=>auth.gateway.call('admin.users',{actor_id:req.principal!.userId}));
 app.patch('/api/admin/users/:id',async(req,reply)=>{const target=z.string().uuid().safeParse((req.params as any).id);const body=z.object({role:z.enum(['admin','petugas','viewer']),status:z.enum(['active','disabled']),scopes:z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)).max(100)}).strict().safeParse(req.body);if(!target.success||!body.success)return reply.code(422).send({error:{code:'INVALID_MEMBERSHIP'}});if(target.data===req.principal!.userId)throw new AccessError(403,'SELF_CHANGE_FORBIDDEN');return auth.gateway.call('admin.update',{actor_id:req.principal!.userId,user_id:target.data,...body.data});});
 app.post('/api/admin/contexts',async(req,reply)=>{const body=z.object({context_id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),name:z.string().trim().min(1).max(120)}).strict().safeParse(req.body);if(!body.success)return reply.code(422).send({error:{code:'INVALID_CONTEXT'}});await auth.gateway.call('admin.context',{actor_id:req.principal!.userId,...body.data});return reply.code(201).send({success:true});});
 app.get('/api/admin/audit',async req=>auth.gateway.call('admin.audit',{actor_id:req.principal!.userId}));
 app.get('/api/audit',async req=>auth.gateway.call('audit.own',{actor_id:req.principal!.userId}));
 app.post('/api/batches/:id/publication',async(req,reply)=>{const body=z.object({content_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(req.body);if(!body.success)return reply.code(422).send({error:{code:'INVALID_APPROVAL'}});const batchId=(req.params as any).id;const batch=await auth.gateway.call('entity.get',{kind:'batches',id:batchId});const session=batch&&await auth.gateway.call('entity.get',{kind:'sessions',id:batch.session_id});await auth.session(req.principal!,session);const preview=JSON.parse(batch.bulletin_payload_json||'{}');if(typeof preview.content!=='string'||createHash('sha256').update(preview.content).digest('hex')!==body.data.content_sha256)return reply.code(409).send({error:{code:'PREVIEW_CHANGED'}});return auth.gateway.call('publication.approve',{actor_id:req.principal!.userId,context_id:session.context_id,batch_id:batchId,content_sha256:body.data.content_sha256});});
};}
