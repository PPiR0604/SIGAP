import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { logger } from './logging.js';

const configSchema = z.object({
  agentProvider: z.enum(['gemini', 'openai', 'bob', 'mock']).default('gemini'),
  host: z.string().default('127.0.0.1'),
  port: z.coerce.number().default(8787),
  allowedOrigins: z.array(z.string()).default(['http://127.0.0.1:5173', 'http://localhost:5173']),
  authRedirectUrl: z.string().url().refine(value=>{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash;},'URL pengembalian Auth tidak valid.').default('http://localhost:5173/'),
  bobCommand: z.string().default('bob'),
  bobArgs: z.string().default(''),
  bobWorkspace: z.string().default('output/bob-workspace'),
  langflowUrl: z.string().default('http://localhost:7860'),
  snapshotDir: z.string().default('output/.sigap_snapshots'),
  maxInputBytes: z.coerce.number().default(204800),
  retentionDays: z.coerce.number().default(7),
  approvalTtlSeconds: z.coerce.number().default(3600),
  dbPath: z.string().default('data/sigap.db')
});

export type AppConfig = Omit<z.infer<typeof configSchema>, 'agentProvider'|'authRedirectUrl'> & {
  authRedirectUrl?:string;
  supabase?: import('./supabase/client.js').SupabaseSettings;
  agentProvider?: 'gemini' | 'openai' | 'bob' | 'mock';
  sessionToken: string;
};

import { fileURLToPath } from 'node:url';

export function autoLoadEnv(): void {
  // Native scripts always load the repository root .env, regardless of cwd.
  // Docker receives the same file through Compose env_file.
  const candidates = [fileURLToPath(new URL('../../.env',import.meta.url))];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        process.loadEnvFile(p);
        break;
      } catch {
        // ignore
      }
    }
  }
}
autoLoadEnv();

export function loadConfig(): AppConfig {
  autoLoadEnv();
  const allowedOriginsRaw = process.env.SIGAP_ALLOWED_ORIGINS;
  const defaultOrigins = [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:80',
    'http://localhost:80',
    'http://127.0.0.1',
    'http://localhost',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://127.0.0.1:8787',
    'http://localhost:8787'
  ];
  const allowedOrigins = allowedOriginsRaw
    ? allowedOriginsRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
    : defaultOrigins;

  const parsed = configSchema.parse({
    agentProvider: process.env.SIGAP_AGENT_PROVIDER || 'gemini',
    host: process.env.SIGAP_HOST || '127.0.0.1',
    port: process.env.SIGAP_PORT || 8787,
    allowedOrigins,
    authRedirectUrl: process.env.SIGAP_AUTH_REDIRECT_URL || 'http://localhost:5173/',
    bobCommand: process.env.SIGAP_BOB_COMMAND || 'bob',
    bobArgs: process.env.SIGAP_BOB_ARGS || '',
    bobWorkspace: process.env.SIGAP_BOB_WORKSPACE || 'output/bob-workspace',
    langflowUrl: process.env.SIGAP_LANGFLOW_URL || 'http://localhost:7860',
    snapshotDir: process.env.SIGAP_SNAPSHOT_DIR || 'output/.sigap_snapshots',
    maxInputBytes: process.env.SIGAP_MAX_INPUT_BYTES || 204800,
    retentionDays: process.env.SIGAP_METADATA_RETENTION_DAYS || 7,
    approvalTtlSeconds: process.env.SIGAP_APPROVAL_TTL_SECONDS || 3600,
    dbPath: process.env.SIGAP_DB_PATH || 'data/sigap.db'
  });

  const supabase=process.env.SIGAP_SUPABASE_URL ? {
    url:process.env.SIGAP_SUPABASE_URL.replace(/\/$/,''),
    publishableKey:process.env.SIGAP_SUPABASE_PUBLISHABLE_KEY||'',
    gatewaySecret:process.env.SIGAP_SUPABASE_GATEWAY_SECRET||'',
    organizationId:process.env.SIGAP_ORGANIZATION_ID||'',
    bootstrapAdminEmail:process.env.SIGAP_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
  }:undefined;
  if(supabase)return {...parsed,supabase,sessionToken:''};
  // Local SQLite/token configuration is retained for injected test fixtures and migration tooling.
  const dbDir = parsed.dbPath === ':memory:' ? resolve(process.cwd(), 'data') : dirname(resolve(parsed.dbPath));
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  // Handle local session token
  const tokenFile = resolve(dbDir, 'session-token.txt');
  let sessionToken = process.env.SIGAP_SESSION_TOKEN || '';
  if (!sessionToken) {
    if (existsSync(tokenFile)) {
      try {
        sessionToken = readFileSync(tokenFile, 'utf-8').trim();
      } catch {
        sessionToken = '';
      }
    }
    if (!sessionToken) {
      sessionToken = randomBytes(24).toString('hex');
      try {
        writeFileSync(tokenFile, sessionToken, { encoding: 'utf-8', mode: 0o600 });
      } catch (err) {
        logger.warn('Gagal menyimpan session-token.txt:', err);
      }
    }
  }

  return {
    ...parsed,
    supabase,
    sessionToken
  };
}
