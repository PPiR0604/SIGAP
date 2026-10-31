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
import {OpenAICompatibleRuntime} from './openai/runtime.js';
import {loadOpenAISettings} from './openai/config.js';
import type {Repository} from './db/contract.js';
import {SupabaseRepository} from './db/supabase.js';
import {SupabaseGateway,GatewayRejectedError} from './supabase/client.js';
import {AuthService,AccessError} from './auth/service.js';
import {createAuthRoutes} from './routes/auth.js';
import {createCommandRoutes} from './routes/command.js';
import {createRecoveryRoute} from './routes/recovery.js';
import {createOverviewRoute} from './routes/overview.js';
import {createPublicPublicationRoutes,publicBulletinPath} from './routes/publications.js';
import {PublicPublicationService} from './publications/service.js';
import {createDocumentsRoute,type DocumentExtractor} from './routes/documents.js';

export interface BuildServerOptions {
  config?: AppConfig;
  repo?: Repository;
  auth?:AuthService;
  runtime?: AgentRuntime;
  sessionConfig?: Partial<AgentSessionConfig>;
  documentExtractor?:DocumentExtractor;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<{
  app: FastifyInstance;
  config: AppConfig;
  repo: Repository;
  orchestrator: BatchOrchestrator;
}> {
  const config = options.config || loadConfig();
  const provider = config.agentProvider || 'gemini';
  if (!['gemini', 'openai', 'bob', 'mock'].includes(provider)) throw new Error('Agent provider tidak valid.');
  // Only injected test repositories use the legacy token fixture. Production is fail-closed.
  if(!options.repo&&!config.supabase)throw new Error('Konfigurasi Supabase Auth dan database wajib diisi.');
  if(config.supabase&&(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.supabase.url)||!config.supabase.publishableKey||config.supabase.gatewaySecret.length<48||!config.supabase.organizationId))throw new Error('Konfigurasi Supabase tidak lengkap.');
  const auth=options.auth??(config.supabase?new AuthService(new SupabaseGateway(config.supabase)):undefined);
  const repo = options.repo || new SupabaseRepository(auth!.gateway);

  let runtime = options.runtime;
  if (!runtime) {
    if (provider === 'gemini') runtime = new GeminiAgentRuntime(loadGeminiSettings());
    else if(provider==='openai')runtime=new OpenAICompatibleRuntime(loadOpenAISettings());
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

  const sessionConfig = options.sessionConfig || (runtime instanceof FakeAgentRuntime ? {} : loadAgentSessionConfig(runtime instanceof OpenAICompatibleRuntime ? 'openai' : runtime instanceof GeminiAgentRuntime ? 'gemini' : 'bob'));
  const mcpConfigured = runtime instanceof GeminiAgentRuntime
    ? !!sessionConfig.mcpServerConfig?.some((server: any) => server.name === 'langflow' && server.type === 'http')
    : !!sessionConfig.mcpServerConfig?.length;
  const writeControlVerified = mcpConfigured && (runtime instanceof GeminiAgentRuntime || process.env.SIGAP_ACP_WRITE_CONTROL_VERIFIED === '1');
  const orchestrator = new BatchOrchestrator(repo, runtime, sessionConfig, config.approvalTtlSeconds, writeControlVerified);
  orchestrator.auth=auth;
  const security = createSecurityHooks(config);
  const publicAuthPaths=new Set(['/api/auth/register','/api/auth/login','/api/auth/refresh','/api/auth/password/reset','/api/auth/password/recover']);

  const app = Fastify({
    logger: false,
    bodyLimit: config.maxInputBytes + 10240
  });

  // Global preHandler security hook
  app.addHook('preHandler', async (request, reply) => {
    await security.validateOrigin(request, reply);
    if (reply.sent) return;
    if(['GET','HEAD'].includes(request.method)&&publicBulletinPath.test(request.url.split('?')[0]))return;
    if(!auth){await security.requireAuth(request, reply);return;}
    const path=request.url.split('?')[0];
    if(path==='/api/health'||publicAuthPaths.has(path))return;
    if(path==='/api/internal/langflow')return; // Dedicated signed capability below.
    request.principal=await auth.authenticate(request.headers.authorization);
    if(path.startsWith('/api/auth/'))return;
    auth.active(request.principal);
    if(path.startsWith('/api/admin/')||/^\/api\/batches\/[^/]+\/publication(?:[-/]|$)/.test(path))if(request.principal.membership.role!=='admin')throw new AccessError(403,'ADMIN_REQUIRED');
    if(path==='/api/publications')return;
    if(request.principal.membership.role==='viewer')throw new AccessError(403,'READ_ONLY_ROLE');
    const sessionMatch=/^\/api\/sessions\/([^/]+)\//.exec(path),batchMatch=/^\/api\/batches\/([^/]+)/.exec(path);
    if(sessionMatch)await auth.session(request.principal,await repo.getSession(decodeURIComponent(sessionMatch[1])));
    if(batchMatch){const batch=await repo.getBatch(decodeURIComponent(batchMatch[1]));await auth.session(request.principal,batch?await repo.getSession(batch.session_id):null);}
  });
  app.setErrorHandler((error:any,request,reply)=>{if(error instanceof AccessError)return reply.code(error.status).send({error:{code:error.code}});if(error instanceof GatewayRejectedError)return reply.code(403).send({error:{code:'OPERATION_REJECTED'}});logger.error('Permintaan backend gagal',{code:error.code});return reply.code(error.statusCode&&error.statusCode<500?error.statusCode:503).send({error:{code:'REQUEST_FAILED'}});});
  if(auth)app.post('/api/internal/langflow',{bodyLimit:8*1024*1024},async(request,reply)=>{
    const cap=auth.verifyCapability(String(request.headers['x-sigap-capability']??''));
    await auth.stillAuthorized(cap.actor_id,cap.auth_session_id,cap.context_id);
    const body=request.body as any;
    const allowed=['flow.save','flow.load','storage.read'];
    if(cap.tool==='upsert_shelter')allowed.push('storage.commit','storage.receipt','flow.commit');
    if(!body||!allowed.includes(body.action))throw new AccessError(403,'CAPABILITY_DENIED');
    if(body.action==='storage.commit'||body.action==='storage.receipt'){
      if(body.args?.source_snapshot?.snapshot_id!==cap.write_reference?.snapshot_id||body.args?.source_snapshot?.snapshot_sha256!==cap.write_reference?.snapshot_sha256)throw new AccessError(403,'WRITE_REFERENCE_MISMATCH');
    }
    return {data:await auth.gateway.call(body.action,{...body.args,actor_id:cap.actor_id,context_id:cap.context_id})};
  });

  // Register routes
  await app.register(createHealthRoute(repo, runtime, writeControlVerified, mcpConfigured, auth?'':config.sessionToken));
  if(auth){await app.register(createAuthRoutes(auth,config.authRedirectUrl));await app.register(createCommandRoutes(auth));}
  if(auth)await app.register(createPublicPublicationRoutes(new PublicPublicationService(repo,auth,orchestrator)));
  await app.register(createSessionsRoute(repo,auth,orchestrator));
  await app.register(createRecoveryRoute(repo,auth,orchestrator));
  await app.register(createOverviewRoute(repo,orchestrator));
  await app.register(createMessagesRoute(repo, orchestrator, config));
  await app.register(createDocumentsRoute(repo,options.documentExtractor));
  await app.register(createEventsRoute(repo, orchestrator));
  await app.register(createBatchesRoute(repo));
  await app.register(createDecisionsRoute(repo, orchestrator));
  app.addHook('onClose', async () => {
    await orchestrator.shutdown();
    if (!options.repo) await repo.close();
  });

  return { app, config, repo, orchestrator };
}

// Start if executed directly
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  buildServer()
    .then(async ({ app, config }) => {
      const address = await app.listen({ host: config.host, port: config.port });
      logger.info(`Backend SIGAP berjalan di ${address}`);
      logger.info('Supabase Auth aktif; akses operasional memerlukan akun aktif dan penugasan.');
    })
    .catch((err) => {
      logger.error('Gagal menjalankan server:', err);
      process.exit(1);
    });
}
