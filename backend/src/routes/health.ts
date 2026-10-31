import type { FastifyPluginAsync } from 'fastify';
import type { Repository } from '../db/contract.js';
import type { AgentRuntime } from '../acp/types.js';
import { FakeAgentRuntime } from '../acp/fakeRuntime.js';

export function createHealthRoute(
  repo: Repository,
  runtime: AgentRuntime,
  writeControlVerified = false,
  mcpConfigured = false,
  sessionToken = ''
): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get('/api/health', async (_req, reply) => {
      const agentAvailable = await runtime.isAvailable();
      const simulated = runtime instanceof FakeAgentRuntime;
      const agent = runtime.provider || (simulated ? 'mock' : 'bob');
      return reply.send({
        status: 'ok',
        backend: 'ready',
        agent,
        model:runtime.model,
        provider_status: simulated ? 'simulated' : agentAvailable && mcpConfigured ? 'configured' : 'unavailable',
        bob: ['gemini','openai'].includes(agent) ? 'not_used' : simulated ? 'mock_mode' : agentAvailable ? 'ready' : 'unavailable',
        storage: simulated ? 'simulated' : 'unverified',
        write_enabled: !simulated && agentAvailable && writeControlVerified,
        mode: simulated ? 'mock_mode' : agentAvailable && mcpConfigured ? 'live' : 'degraded',
        timestamp: new Date().toISOString(),
        ...(sessionToken?{session_token:sessionToken}:{})
      });
    });

    if(sessionToken)fastify.get('/api/auth/token', async (_req, reply) => {
      return reply.send({ token: sessionToken });
    });
  };
}
