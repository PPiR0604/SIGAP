import type {FastifyPluginAsync} from 'fastify';
import type {Repository} from '../db/contract.js';
import type {AuthService} from '../auth/service.js';
import {storageRecords} from '../pipeline/storageDocument.js';
import type {BatchOrchestrator} from '../pipeline/orchestrator.js';
import {logger} from '../logging.js';
import {requestSession} from '../auth/requestSession.js';
import {readAuthenticatedRecovery} from '../db/recovery.js';
export function createRecoveryRoute(repo:Repository,auth?:AuthService,orchestrator?:BatchOrchestrator):FastifyPluginAsync{return async app=>{
 app.get('/api/sessions/:id/recovery',async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const id=(request.params as {id:string}).id,session=await requestSession(request,repo,id);
  if(!session)return reply.code(404).send({error:{code:'SESSION_NOT_FOUND'}});
  const started=Date.now();
  // Capture the replay cursor before reading state so concurrent changes remain replayable.
  // Authenticated storage is read directly; its recovery needs only a cursor,
  // not historical preview payloads. Legacy local storage still uses replay.
  const events=auth?[]:await repo.getEventsAfter(id);
  const recovery=auth?readAuthenticatedRecovery(repo,auth.gateway,id,request.principal!.userId,session.context_id):
   Promise.resolve(repo.getWorkspaceState(id)).then(state=>({state,stored:null,afterEventId:events.at(-1)?.event_id||0}));
  // Register the one-use overview handoff while this read is still in flight,
  // so foreground work can invalidate it before a delayed response arrives.
  const state=orchestrator?await orchestrator.recoverWorkspaceState(id,()=>recovery.then(value=>value.state)):(await recovery).state;
  const {stored,afterEventId}=await recovery;
  const reviews=state.reviews.map(({snapshot,batch})=>({batchId:snapshot.batch_id,preview:JSON.parse(snapshot.payload_json),gap:batch.gap_payload_json?JSON.parse(batch.gap_payload_json):null}));
  let records:any[]=[];
  if(auth)records=storageRecords(stored!.document);
  else{const prior=[...events].reverse().find(e=>['stored_rekap_ready','readback_result'].includes(e.event_type));if(prior)records=JSON.parse(prior.payload_json).records||[];}
  logger.info('Pemulihan ruang kerja selesai',{duration_ms:Date.now()-started,reviews:reviews.length,records:records.length});
  return {reviews:reviews.reverse(),records,after_event_id:afterEventId,active_batch:state.activeBatch?.batch_id||null};
 });
};}
