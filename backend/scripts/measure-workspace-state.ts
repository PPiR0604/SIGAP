// Read-only state comparison via an existing live auth session and owned workspace.
// No JWT/capability is fabricated; no model, MCP, batch or snapshot is created.
import '../src/config.js';
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {SupabaseRepository} from '../src/db/supabase.js';
import {AuthService} from '../src/auth/service.js';
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
const original=gateway.call.bind(gateway);let legacy=false,calls:any[]=[];
gateway.call=async<T>(action:string,args:Record<string,unknown>={})=>{
 if(legacy&&args.workspace_state){const {workspace_state,workspace_cutoff,active_only,...rest}=args;args=rest;}
 const started=performance.now(),result=await original<T>(action,args);
 calls.push({action,kind:args.kind,ms:Math.round(performance.now()-started),bytes:Buffer.byteLength(JSON.stringify(result)),bounded:args.workspace_state===true&&!Array.isArray(result)});
 return result;
};
const samples=[];let referenceHash:string|undefined;
for(const mode of ['legacy','bounded','bounded','legacy']){
 await auth.stillAuthorized(userId,authSessionId,contextId);legacy=mode==='legacy';calls=[];
 const started=performance.now(),state=await repo.getWorkspaceState(workspaceId),stateMs=Math.round(performance.now()-started),stateCalls=calls;
 const hash=snapshotHash(state);if(referenceHash)assert.equal(hash,referenceHash);else referenceHash=hash;
 calls=[];const activeStarted=performance.now(),active=await repo.getActiveBatch(workspaceId),activeMs=Math.round(performance.now()-activeStarted);
 assert.deepEqual(active,state.activeBatch);
 samples.push({mode,state_ms:stateMs,state_calls:[...stateCalls],active_ms:activeMs,active_calls:[...calls],reviews:state.reviews.length,active_batch:!!active,state_sha256:hash});
}
const result={read_only:true,includes_jwt_authentication:false,operational_write:false,model_calls:0,mcp_calls:0,samples};
writeFileSync('../ref/workspace-state-'+(process.argv.includes('--before')?'before':process.argv.includes('--history')?'history':'after')+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
