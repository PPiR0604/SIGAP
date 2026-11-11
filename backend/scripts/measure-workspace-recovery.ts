// Read-only recovery benchmark; existing live identity and owned workspace only.
// No JWT/capability is minted, and no model/MCP/operational write is invoked.
import '../src/config.js';
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthenticatedRecovery} from '../src/db/recovery.js';
import {snapshotHash} from '../src/pipeline/rowDrafts.js';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const [userId,authSessionId,contextId,workspaceId]=process.argv.slice(2);
if(!/^[a-f0-9-]{36}$/i.test(userId||'')||!/^[a-f0-9-]{36}$/i.test(authSessionId||'')||!contextId||!/^[a-f0-9]{32}$/.test(workspaceId||''))throw Error('Existing active identity and owned workspace required.');
const settings=loadConfig().supabase;if(!settings)throw Error('Supabase required.');
const gateway=new SupabaseGateway(settings),auth=new AuthService(gateway),repo=new SupabaseRepository(gateway);
await auth.stillAuthorized(userId,authSessionId,contextId);
const workspace=await repo.getSession(workspaceId);
if(workspace?.owner_user_id!==userId||workspace.organization_id!==settings.organizationId||workspace.context_id!==contextId)throw Error('Workspace ownership mismatch.');
const original=gateway.call.bind(gateway);let calls:any[]=[];
gateway.call=async<T>(action:string,args:Record<string,unknown>={})=>{
 const started=performance.now(),result=await original<T>(action,args);
 calls.push({action,kind:args.kind,ms:Math.round(performance.now()-started),bytes:Buffer.byteLength(JSON.stringify(result)),combined:!!args.recovery_session_id});
 return result;
};
const samples=[];let referenceHash:string|undefined;
for(const mode of process.argv.includes('--before')?['legacy','legacy']:['legacy','combined','combined','legacy']){
 await auth.stillAuthorized(userId,authSessionId,contextId);calls=[];
 const started=performance.now();let data;
 if(mode==='legacy'){
  const afterEventId=await repo.getLatestEventId(workspaceId);
  const [state,stored]=await Promise.all([repo.getWorkspaceState(workspaceId),gateway.call('storage.read',{actor_id:userId,context_id:contextId})]);
  data={state,stored,afterEventId};
 }else data=await readAuthenticatedRecovery(repo,gateway,workspaceId,userId,contextId);
 const duration=Math.round(performance.now()-started),hash=snapshotHash(data);
 if(referenceHash)assert.equal(hash,referenceHash,'Live recovery changed; comparison is not valid');else referenceHash=hash;
 if(mode==='combined')assert.equal(calls.length,1,'Hosted gateway has not enabled combined recovery');
 samples.push({mode,duration_ms:duration,calls:[...calls],reviews:data.state.reviews.length,storage_revision:data.stored.revision,after_event_id:data.afterEventId,result_sha256:hash});
}
const result={read_only:true,includes_jwt_authentication:false,model_calls:0,mcp_calls:0,operational_write:false,samples};
writeFileSync('../ref/workspace-recovery-'+(process.argv.includes('--before')?'before':'after')+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
