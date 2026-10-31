import type {FastifyPluginAsync} from 'fastify';
import {createHash, randomBytes} from 'node:crypto';
import {z} from 'zod';
import type {AuthService} from '../auth/service.js';

const contextId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const assignment = z.object({
  role: z.enum(['admin', 'petugas', 'viewer']),
  scopes: z.array(contextId).max(100).transform(values => [...new Set(values)])
});
const operation = z.object({
  context_id: contextId,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default('')
}).strict();

/** A command is the configured organization; joining never creates a new tenant or admin. */
export function createCommandRoutes(auth: AuthService): FastifyPluginAsync {
  return async app => {
    app.addHook('onSend', async (_request, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    });
    app.get('/api/auth/command', async () => auth.gateway.call('command.info', {
      organization_id: auth.gateway.settings.organizationId
    }));
    app.post('/api/auth/join-requests', async (req, reply) => {
      const body = z.object({note: z.string().trim().max(500).default('')}).strict().safeParse(req.body ?? {});
      if (!body.success) return reply.code(422).send({error: {code: 'INVALID_JOIN_REQUEST'}});
      return reply.code(202).send(await auth.gateway.call('membership.request', {
        actor_id: req.principal!.userId, organization_id: auth.gateway.settings.organizationId, ...body.data
      }));
    });
    app.get('/api/auth/join-requests', async req => auth.gateway.call('membership.requests', {
      actor_id: req.principal!.userId, organization_id: auth.gateway.settings.organizationId
    }));
    app.post('/api/auth/invitations/accept', async (req, reply) => {
      const body = z.object({token: z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().safeParse(req.body);
      if (!body.success) return reply.code(422).send({error: {code: 'INVALID_INVITATION'}});
      return auth.gateway.call('membership.accept', {
        actor_id: req.principal!.userId, organization_id: auth.gateway.settings.organizationId,
        token_hash: createHash('sha256').update(body.data.token).digest('hex')
      });
    });
    app.get('/api/admin/command', async req => auth.gateway.call('admin.command.get', {actor_id: req.principal!.userId}));
    app.patch('/api/admin/command', async (req, reply) => {
      const body = z.object({name: z.string().trim().min(1).max(120)}).strict().safeParse(req.body);
      if (!body.success) return reply.code(422).send({error: {code: 'INVALID_COMMAND'}});
      return auth.gateway.call('admin.command.update', {actor_id: req.principal!.userId, ...body.data});
    });
    app.get('/api/admin/join-requests', async req => auth.gateway.call('admin.requests', {actor_id: req.principal!.userId}));
    app.post('/api/admin/join-requests/:id/decision', async (req, reply) => {
      const id = z.string().uuid().safeParse((req.params as {id: string}).id);
      const body = z.discriminatedUnion('decision', [
        assignment.extend({decision: z.literal('approve')}).strict(),
        z.object({decision: z.literal('reject')}).strict()
      ]).safeParse(req.body);
      if (!id.success || !body.success) return reply.code(422).send({error: {code: 'INVALID_JOIN_DECISION'}});
      return auth.gateway.call('admin.request.decide', {actor_id: req.principal!.userId, request_id: id.data, ...body.data});
    });
    app.post('/api/admin/invitations', async (req, reply) => {
      const body = assignment.extend({
        email: z.string().trim().email().max(254).transform(email => email.toLowerCase()),
        expires_in_hours: z.number().int().min(1).max(168).default(24)
      }).strict().safeParse(req.body);
      if (!body.success) return reply.code(422).send({error: {code: 'INVALID_INVITATION'}});
      const token = randomBytes(32).toString('base64url');
      const {expires_in_hours, ...data} = body.data;
      const invitation = await auth.gateway.call('admin.invitation.create', {
        actor_id: req.principal!.userId, ...data,
        token_hash: createHash('sha256').update(token).digest('hex'),
        expires_at: new Date(Date.now() + expires_in_hours * 3600000).toISOString()
      });
      // Returned once for the admin to share; never sent by email automatically.
      return reply.code(201).send({...invitation, token});
    });
    app.get('/api/admin/invitations', async req => auth.gateway.call('admin.invitations', {actor_id: req.principal!.userId}));
    app.delete('/api/admin/invitations/:id', async (req, reply) => {
      const id = z.string().uuid().safeParse((req.params as {id: string}).id);
      if (!id.success) return reply.code(422).send({error: {code: 'INVALID_INVITATION'}});
      await auth.gateway.call('admin.invitation.revoke', {actor_id: req.principal!.userId, invitation_id: id.data});
      return reply.code(204).send();
    });
    // Explicit selection is request-scoped, so devices and concurrent tabs cannot change each other's workspace.
    app.get('/api/contexts/:id', async (req, reply) => {
      const id = contextId.safeParse((req.params as {id: string}).id);
      if (!id.success) return reply.code(422).send({error: {code: 'INVALID_CONTEXT'}});
      await auth.scope(req.principal!, id.data);
      return auth.gateway.call('context.get', {actor_id: req.principal!.userId, context_id: id.data});
    });
    app.post('/api/admin/operations', async (req, reply) => {
      const body = operation.safeParse(req.body);
      if (!body.success) return reply.code(422).send({error: {code: 'INVALID_OPERATION'}});
      return reply.code(201).send(await auth.gateway.call('admin.operation.create', {actor_id: req.principal!.userId, ...body.data}));
    });
    app.patch('/api/admin/operations/:id', async (req, reply) => {
      const body = operation.omit({context_id: true}).safeParse(req.body);
      const id = contextId.safeParse((req.params as {id: string}).id);
      if (!body.success || !id.success) return reply.code(422).send({error: {code: 'INVALID_OPERATION'}});
      return auth.gateway.call('admin.operation.update', {actor_id: req.principal!.userId, context_id: id.data, ...body.data});
    });
  };
}
