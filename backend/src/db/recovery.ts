import type {Repository} from './contract.js';
import type {SupabaseGateway} from '../supabase/client.js';
import {checkedWorkspaceState,type WorkspaceState} from './workspace.js';

export interface RecoveryRead {
  state:WorkspaceState;
  afterEventId:number;
  stored:{document:any;revision?:number};
}

/** Read cursor, candidates and canonical storage from the same database snapshot. */
export async function readAuthenticatedRecovery(repo:Repository,gateway:Pick<SupabaseGateway,'call'>,
  sessionId:string,actorId:string,contextId:string):Promise<RecoveryRead>{
  const stored=await gateway.call('storage.read',{
    actor_id:actorId,context_id:contextId,recovery_session_id:sessionId,workspace_cutoff:new Date().toISOString(),
  });
  if(!stored||typeof stored!=='object'||Array.isArray(stored)||!Object.hasOwn(stored,'document'))throw Error('Invalid recovery storage');
  if(Object.hasOwn(stored,'recovery')){
    const recovery=stored.recovery;
    if(!recovery||recovery.session_id!==sessionId||!Number.isSafeInteger(recovery.after_event_id)||recovery.after_event_id<0||
      !Number.isSafeInteger(stored.revision)||stored.revision<0)throw Error('Invalid recovery state');
    return {state:checkedWorkspaceState(recovery.state,sessionId),afterEventId:recovery.after_event_id,stored:{document:stored.document,revision:stored.revision}};
  }
  // Older gateways ignore the additive options. Discard their storage read:
  // reusing it with a newer cursor could hide a commit made between the two.
  const afterEventId=await repo.getLatestEventId(sessionId);
  const [state,currentStored]=await Promise.all([
    repo.getWorkspaceState(sessionId),gateway.call('storage.read',{actor_id:actorId,context_id:contextId}),
  ]);
  return {state,afterEventId,stored:currentStored};
}
