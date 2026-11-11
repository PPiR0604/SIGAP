// Read-only signed-gateway maintenance probe. Never creates a batch or issues a capability.
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {AuthService,type Principal,type Membership} from '../src/auth/service.js';

async function main(){
 const [userId,authSessionId,contextId,workspaceId]=process.argv.slice(2),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!uuid.test(userId||'')||!uuid.test(authSessionId||'')||!contextId)throw Error('Active identity required');
 if(workspaceId&&!/^[a-f0-9]{32}$/.test(workspaceId))throw Error('Invalid workspace');
 const config=loadConfig();if(!config.supabase)throw Error('Configured gateway required');
 const gateway=new SupabaseGateway(config.supabase),repo=new SupabaseRepository(gateway),auth=new AuthService(gateway);
 const membership=await gateway.call<Membership>('profile.get',{user_id:userId});
 const principal:Principal={userId,sessionId:authSessionId,expiresAt:0,token:'',membership};auth.active(principal);
 await auth.stillAuthorized(userId,authSessionId,contextId);
 const session=workspaceId?await repo.getSession(workspaceId):await repo.resumableSession(contextId,userId,config.supabase.organizationId);await auth.session(principal,session);
 if(!session)throw Error('No owned workspace');
 if(session.context_id!==contextId)throw Error('Workspace scope mismatch');
 const dispatch=gateway.call.bind(gateway);let calls=0,bytes=0;
 gateway.call=async<T>(action:string,args:Record<string,unknown>={})=>{calls++;const result=await dispatch<T>(action,args);bytes+=Buffer.byteLength(JSON.stringify(result));return result;};
 const requestId='latency-probe-'+randomUUID(),samples=[];let baseline:unknown;
 for(const mode of ['legacy','combined','combined','legacy','legacy','combined']){
  // Authentication is real and fresh, but outside this resource-read measurement.
  await auth.stillAuthorized(userId,authSessionId,contextId);calls=0;bytes=0;const started=performance.now();
  const state=mode==='legacy'?{existingBatch:await repo.getBatchByRequestId(requestId,session.session_id),activeBatchId:(await repo.getActiveBatch(session.session_id))?.batch_id??null,firstTurn:(await repo.countBatches(session.session_id))===0}:await repo.getSubmissionState(session.session_id,requestId);
  const ms=Math.round(performance.now()-started);
  if(baseline!==undefined&&!isDeepStrictEqual(state,baseline))throw Error('Workspace changed during measurement');baseline=state;
  samples.push({mode,ms,gateway_calls:calls,response_bytes:bytes,has_existing:!!state.existingBatch,has_active:!!state.activeBatchId,first_turn:state.firstTurn});
 }
 console.log(JSON.stringify({read_only:true,includes_jwt_authentication:false,includes_scope_checks:false,samples},null,2));
}
main().catch(error=>{console.error(JSON.stringify({measurement_failed:true,name:error?.name,code:typeof error?.code==='string'?error.code:null,message:['Active identity required','Configured gateway required','Invalid workspace','No owned workspace','Workspace scope mismatch','Workspace changed during measurement','Invalid submission state'].includes(error?.message)?error.message:'Live access or gateway check failed'}));process.exitCode=1;});
