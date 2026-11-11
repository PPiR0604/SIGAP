import type { FastifyPluginAsync } from 'fastify';
import type { Repository } from '../db/contract.js';
import type { BatchOrchestrator } from '../pipeline/orchestrator.js';
import {requestSession} from '../auth/requestSession.js';

export function createEventsRoute(
  repo: Repository,
  orchestrator: BatchOrchestrator
): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get('/api/sessions/:id/events', async (request, reply) => {
      const { id: sessionId } = request.params as { id: string };

      const session = await requestSession(request,repo,sessionId);
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

      // Subscribe before the database read. Events committed during replay must
      // survive the handoff, while events present in both paths are sent once.
      let replaying=true,closed=false,checking=false,lastSentId=startAfterId;
      let heartbeatTimer:ReturnType<typeof setInterval>|undefined;
      const queued:any[]=[];
      const writeLive=(ev:any)=>{
        if(closed||ev.event_id&&ev.event_id<=lastSentId)return;
        reply.raw.write(`id: ${ev.event_id || ''}\n`);
        reply.raw.write(`event: ${ev.event_type}\n`);
        reply.raw.write(`data: ${JSON.stringify(ev.payload || {})}\n\n`);
        if(ev.event_id)lastSentId=ev.event_id;
      };
      const liveListener=(ev:any)=>{
        if(ev.session_id!==sessionId||closed)return;
        if(replaying)queued.push(ev);else writeLive(ev);
      };
      const cleanup=()=>{
        closed=true;
        if(heartbeatTimer)clearInterval(heartbeatTimer);
        orchestrator.off('event',liveListener);
      };
      orchestrator.on('event',liveListener);
      reply.raw.once('close',cleanup);

      // Replay existing events
      let pastEvents;
      try{pastEvents=await repo.getEventsAfter(sessionId,startAfterId);}
      catch(error){cleanup();reply.raw.destroy(error instanceof Error?error:undefined);return;}
      if(closed)return;
      for (const ev of pastEvents) {
        if(ev.event_id<=lastSentId)continue;
        reply.raw.write(`id: ${ev.event_id}\n`);
        reply.raw.write(`event: ${ev.event_type}\n`);
        reply.raw.write(`data: ${ev.payload_json}\n\n`);
        lastSentId=ev.event_id;
      }

      // If stream=false is specified, end response immediately (useful for tests and one-shot checks)
      if ((request.query as any)?.stream === 'false') {
        cleanup();
        reply.raw.end();
        return;
      }

      for(const ev of queued.sort((a,b)=>(a.event_id||0)-(b.event_id||0)))writeLive(ev);
      queued.length=0;
      replaying=false;

      // Heartbeat every 15s
      heartbeatTimer = setInterval(async () => {
        if(checking)return;checking=true;
        try {
          if(request.principal&&orchestrator.auth){if(request.principal.expiresAt<=Date.now())throw new Error('Session expired');await orchestrator.auth.stillAuthorized(request.principal.userId,request.principal.sessionId,session.context_id);}
          if(!closed)reply.raw.write(': heartbeat\n\n');
        } catch {
          cleanup();reply.raw.end();
        }finally{checking=false;}
      }, 15000);

    });
  };
}
