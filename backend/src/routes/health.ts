import type { FastifyPluginAsync } from 'fastify';
import type { SigapRepository } from '../db/repo.js';
import type { AgentRuntime } from '../acp/types.js';
import { FakeAgentRuntime } from '../acp/fakeRuntime.js';

export function createHealthRoute(
  repo: SigapRepository,
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
        provider_status: simulated ? 'simulated' : agentAvailable && mcpConfigured ? 'configured' : 'unavailable',
        bob: agent === 'gemini' ? 'not_used' : simulated ? 'mock_mode' : agentAvailable ? 'ready' : 'unavailable',
        storage: simulated ? 'simulated' : 'unverified',
        write_enabled: !simulated && agentAvailable && writeControlVerified,
        mode: simulated ? 'mock_mode' : agentAvailable && mcpConfigured ? 'live' : 'degraded',
        timestamp: new Date().toISOString(),
        session_token: sessionToken
      });
    });

    fastify.get('/api/auth/token', async (_req, reply) => {
      return reply.send({ token: sessionToken });
    });
  };
}
