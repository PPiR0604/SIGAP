// Read-only signed-gateway comparison of repeated vs request-owned session reads.
// Measures resource lookup + live scope check, not JWT authentication or a page load.
import type {FastifyRequest} from 'fastify';
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {AuthService,type Membership,type Principal} from '../src/auth/service.js';
import {rememberAuthorizedSession,requestSession} from '../src/auth/requestSession.js';

async function main(){
 const [userId,authSessionId,contextId]=process.argv.slice(2);
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!uuid.test(userId||'')||!uuid.test(authSessionId||'')||!contextId)throw new Error('Active scoped identity required');
 const config=loadConfig();if(!config.supabase)throw new Error('Configured Supabase required');
 const gateway=new SupabaseGateway(config.supabase),repo=new SupabaseRepository(gateway),auth=new AuthService(gateway);
 const membership=await gateway.call<Membership>('profile.get',{user_id:userId});
 // Privileged maintenance reads use the signed gateway, not an expired JWT or
 // an invented access token. This principal cannot issue a valid tool capability.
 const principal:Principal={userId,sessionId:authSessionId,expiresAt:0,token:'',membership};auth.active(principal);
 await auth.stillAuthorized(userId,authSessionId,contextId);
 const session=await repo.resumableSession(contextId,userId,config.supabase.organizationId);if(!session)throw new Error('No active owned workspace');
 const original=gateway.call.bind(gateway);let reads=0,scopes=0;
 gateway.call=async<T>(action:string,args:Record<string,unknown>={})=>{if(action==='entity.get'&&args.kind==='sessions')reads++;if(action==='scope.check')scopes++;return original<T>(action,args);};
 const samples=[];
 for(const mode of ['legacy','request_owned','request_owned','legacy','legacy','request_owned']){
  reads=0;scopes=0;const started=performance.now();
  const checked=await repo.getSession(session.session_id);await auth.session(principal,checked);
  let used;
  if(mode==='legacy')used=await repo.getSession(session.session_id);
  else{const request={} as FastifyRequest;rememberAuthorizedSession(request,checked!);used=await requestSession(request,repo,session.session_id);}
  if(used?.session_id!==session.session_id||used?.context_id!==contextId)throw new Error('Workspace identity changed');
  samples.push({mode,ms:Math.round(performance.now()-started),session_reads:reads,live_scope_checks:scopes});
 }
 console.log(JSON.stringify({read_only:true,includes_jwt_authentication:false,samples},null,2));
}
main().catch(error=>{console.error(JSON.stringify({measurement_failed:true,error_name:error?.name,code:error?.code??null,message:['Active scoped identity required','Configured Supabase required','No active owned workspace','Workspace identity changed'].includes(error?.message)?error.message:'Live access check or resource read failed'}));process.exitCode=1;});
