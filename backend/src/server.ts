import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from './config.js';
import { SigapRepository } from './db/repo.js';
import { createSecurityHooks } from './security.js';
import { AcpProcessRuntime } from './acp/process.js';
import { FakeAgentRuntime } from './acp/fakeRuntime.js';
import type { AgentRuntime, AgentSessionConfig } from './acp/types.js';
import { BatchOrchestrator } from './pipeline/orchestrator.js';
import { createHealthRoute } from './routes/health.js';
import { createSessionsRoute } from './routes/sessions.js';
import { createMessagesRoute } from './routes/messages.js';
import { createEventsRoute } from './routes/events.js';
import { createBatchesRoute } from './routes/batches.js';
import { createDecisionsRoute } from './routes/decisions.js';
import { logger } from './logging.js';
import { loadAgentSessionConfig } from './acp/sessionConfig.js';
import { GeminiAgentRuntime } from './gemini/runtime.js';
import { loadGeminiSettings } from './gemini/config.js';

export interface BuildServerOptions {
  config?: AppConfig;
  repo?: SigapRepository;
  runtime?: AgentRuntime;
  sessionConfig?: Partial<AgentSessionConfig>;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<{
  app: FastifyInstance;
  config: AppConfig;
  repo: SigapRepository;
  orchestrator: BatchOrchestrator;
}> {
  const config = options.config || loadConfig();
  const provider = config.agentProvider || 'gemini';
  if (!['gemini', 'bob', 'mock'].includes(provider)) throw new Error('Agent provider tidak valid.');
  const repo = options.repo || new SigapRepository(config.dbPath);

  let runtime = options.runtime;
  if (!runtime) {
    if (provider === 'gemini') runtime = new GeminiAgentRuntime(loadGeminiSettings());
    else if (provider === 'mock') runtime = new FakeAgentRuntime();
    else {
    const acpRuntime = new AcpProcessRuntime(config.bobCommand, config.bobArgs, config.bobWorkspace);
    if (await acpRuntime.isAvailable()) {
      runtime = acpRuntime;
    } else {
      logger.info('Bob Shell tidak tersedia di lingkungan ini. Memulai backend dengan FakeAgentRuntime.');
      runtime = new FakeAgentRuntime();
    }
    }
  }

  const sessionConfig = options.sessionConfig || (runtime instanceof FakeAgentRuntime ? {} : loadAgentSessionConfig(runtime instanceof GeminiAgentRuntime ? 'gemini' : 'bob'));
  const mcpConfigured = runtime instanceof GeminiAgentRuntime
    ? !!sessionConfig.mcpServerConfig?.some((server: any) => server.name === 'langflow' && server.type === 'http')
    : !!sessionConfig.mcpServerConfig?.length;
  const writeControlVerified = mcpConfigured && (runtime instanceof GeminiAgentRuntime || process.env.SIGAP_ACP_WRITE_CONTROL_VERIFIED === '1');
  const orchestrator = new BatchOrchestrator(repo, runtime, sessionConfig, config.approvalTtlSeconds, writeControlVerified);
  const security = createSecurityHooks(config);

  const app = Fastify({
    logger: false,
    bodyLimit: config.maxInputBytes + 10240
  });

  // Global preHandler security hook
  app.addHook('preHandler', async (request, reply) => {
    await security.validateOrigin(request, reply);
    if (reply.sent) return;
    await security.requireAuth(request, reply);
  });

  // Register routes
  await app.register(createHealthRoute(repo, runtime, writeControlVerified, mcpConfigured, config.sessionToken));
  await app.register(createSessionsRoute(repo));
  await app.register(createMessagesRoute(repo, orchestrator, config));
  await app.register(createEventsRoute(repo, orchestrator));
  await app.register(createBatchesRoute(repo));
  await app.register(createDecisionsRoute(repo, orchestrator));
  app.addHook('onClose', async () => {
    await orchestrator.shutdown();
    if (!options.repo) repo.close();
  });

  return { app, config, repo, orchestrator };
}

// Start if executed directly
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  buildServer()
    .then(async ({ app, config }) => {
      const address = await app.listen({ host: config.host, port: config.port });
      logger.info(`Backend SIGAP berjalan di ${address}`);
      logger.info(`Session Token disimpan di backend/data/session-token.txt`);
    })
    .catch((err) => {
      logger.error('Gagal menjalankan server:', err);
      process.exit(1);
    });
}
