import type { FastifyPluginAsync } from 'fastify';
import type { SigapRepository } from '../db/repo.js';
import type { BatchOrchestrator } from '../pipeline/orchestrator.js';

export function createEventsRoute(
  repo: SigapRepository,
  orchestrator: BatchOrchestrator
): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get('/api/sessions/:id/events', async (request, reply) => {
      const { id: sessionId } = request.params as { id: string };

      const session = repo.getSession(sessionId);
      if (!session) {
        return reply.code(404).send({
          error: {
            code: 'SESSION_NOT_FOUND',
            message: `Sesi ${sessionId} tidak ditemukan.`
          }
        });
      }

      // Set headers for SSE
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders();

      // Determine starting event ID for replay
      const lastEventIdHeader = request.headers['last-event-id'];
      const queryLastId = (request.query as any)?.lastEventId;
      const startAfterId = Number(lastEventIdHeader || queryLastId || 0);

      // Replay existing events
      const pastEvents = repo.getEventsAfter(sessionId, startAfterId);
      for (const ev of pastEvents) {
        reply.raw.write(`id: ${ev.event_id}\n`);
        reply.raw.write(`event: ${ev.event_type}\n`);
        reply.raw.write(`data: ${ev.payload_json}\n\n`);
      }

      // If stream=false is specified, end response immediately (useful for tests and one-shot checks)
      if ((request.query as any)?.stream === 'false') {
        reply.raw.end();
        return;
      }

      // Event listener for live events
      const liveListener = (ev: any) => {
        if (ev.session_id === sessionId) {
          reply.raw.write(`id: ${ev.event_id || ''}\n`);
          reply.raw.write(`event: ${ev.event_type}\n`);
          reply.raw.write(`data: ${JSON.stringify(ev.payload || {})}\n\n`);
        }
      };

      orchestrator.on('event', liveListener);

      // Heartbeat every 15s
      const heartbeatTimer = setInterval(() => {
        try {
          reply.raw.write(': heartbeat\n\n');
        } catch {
          clearInterval(heartbeatTimer);
        }
      }, 15000);

      // Cleanup when connection closes
      request.raw.on('close', () => {
        clearInterval(heartbeatTimer);
        orchestrator.off('event', liveListener);
      });
    });
  };
}
