import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SigapRepository } from '../db/repo.js';

const CreateSessionBodySchema = z.object({
  context_id: z.string().optional()
});

export function createSessionsRoute(repo: SigapRepository): FastifyPluginAsync {
  return async (fastify) => {
    fastify.post('/api/sessions', async (request, reply) => {
      const parsed = CreateSessionBodySchema.safeParse(request.body || {});
      const contextId = parsed.success && parsed.data.context_id ? parsed.data.context_id : 'posko-default';

      const session = repo.createSession(contextId);
      return reply.code(201).send({
        session_id: session.session_id,
        context_id: session.context_id,
        created_at: session.created_at
      });
    });
  };
}
