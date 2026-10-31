import type {FastifyPluginAsync} from 'fastify';
import type {Repository} from '../db/contract.js';
import type {AuthService} from '../auth/service.js';
import {storageRecords} from '../pipeline/storageDocument.js';
import type {BatchOrchestrator} from '../pipeline/orchestrator.js';
import {logger} from '../logging.js';
export function createRecoveryRoute(repo:Repository,auth?:AuthService,orchestrator?:BatchOrchestrator):FastifyPluginAsync{return async app=>{
 app.get('/api/sessions/:id/recovery',async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const id=(request.params as {id:string}).id,session=await repo.getSession(id);
  if(!session)return reply.code(404).send({error:{code:'SESSION_NOT_FOUND'}});
  const started=Date.now();
  // Capture the replay cursor before reading state so concurrent changes remain replayable.
  const events=await repo.getEventsAfter(id);
  const [state,stored]=await Promise.all([
   orchestrator?orchestrator.recoverWorkspaceState(id):repo.getWorkspaceState(id),
   auth?auth.gateway.call('storage.read',{actor_id:request.principal!.userId,context_id:session.context_id}):Promise.resolve(null)
  ]);
  const reviews=state.reviews.map(({snapshot,batch})=>({batchId:snapshot.batch_id,preview:JSON.parse(snapshot.payload_json),gap:batch.gap_payload_json?JSON.parse(batch.gap_payload_json):null}));
  let records:any[]=[];
  if(auth)records=storageRecords(stored.document);
  else{const prior=[...events].reverse().find(e=>['stored_rekap_ready','readback_result'].includes(e.event_type));if(prior)records=JSON.parse(prior.payload_json).records||[];}
  logger.info('Pemulihan ruang kerja selesai',{duration_ms:Date.now()-started,reviews:reviews.length,records:records.length});
  return {reviews:reviews.reverse(),records,after_event_id:events.at(-1)?.event_id||0,active_batch:state.activeBatch?.batch_id||null};
 });
};}
