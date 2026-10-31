import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type {AuthService} from '../auth/service.js';
import {SupabaseRepository} from '../db/supabase.js';
import type { Repository } from '../db/contract.js';
import type {BatchOrchestrator} from '../pipeline/orchestrator.js';

const CreateSessionBodySchema = z.object({
  context_id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  resume:z.boolean().optional()
}).strict();

export function createSessionsRoute(repo: Repository,auth?:AuthService,orchestrator?:BatchOrchestrator): FastifyPluginAsync {
  return async (fastify) => {
    fastify.post('/api/sessions', async (request, reply) => {
      const parsed = CreateSessionBodySchema.safeParse(request.body || {});
      const contextId = parsed.success && parsed.data.context_id ? parsed.data.context_id : 'posko-default';
      if(auth){if(!parsed.success)return reply.code(422).send({error:{code:'INVALID_CONTEXT'}});await auth.scope(request.principal!,contextId);}

      if(auth&&parsed.success&&parsed.data.resume&&repo instanceof SupabaseRepository){
        const existing=await repo.resumableSession(contextId,request.principal!.userId,request.principal!.membership.organization_id!);
        if(existing){
          const pending=await repo.getActiveBatch(existing.session_id);
          if(pending&&orchestrator&&!orchestrator.isProcessing(existing.session_id)){
            await repo.updateBatchStatus(pending.batch_id,pending.status==='processing'?'failed':'save_status_unknown');
            await repo.logAudit('PROCESS_INTERRUPTED',request.principal!.userId,pending.batch_id,{previous_status:pending.status});
          }
          return reply.code(200).send({session_id:existing.session_id,context_id:existing.context_id,created_at:existing.created_at,resumed:true});
        }
      }
      const session = (await repo.createSession(contextId));
      if(auth){if(!(repo instanceof SupabaseRepository))throw new Error('Authenticated sessions require cloud storage.');await repo.bindSession(session.session_id,request.principal!.userId,request.principal!.membership.organization_id!);}
      return reply.code(201).send({
        session_id: session.session_id,
        context_id: session.context_id,
        created_at: session.created_at
      });
    });
  };
}
