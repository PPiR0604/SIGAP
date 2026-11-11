import type {FastifyPluginAsync} from 'fastify';
import type {Repository} from '../db/contract.js';
import type {BatchOrchestrator} from '../pipeline/orchestrator.js';
import {requestSession} from '../auth/requestSession.js';
export function createOverviewRoute(repo:Repository,orchestrator:BatchOrchestrator):FastifyPluginAsync{return async app=>{
 app.get('/api/sessions/:id/overview',async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const id=(request.params as {id:string}).id;
  const session=await requestSession(request,repo,id);
  if(!session)return reply.code(404).send({error:{code:'SESSION_NOT_FOUND'}});
  if(request.principal)orchestrator.setPrincipal(id,request.principal);
  return orchestrator.readWorkspaceOverview(id,session);
 });
};}
