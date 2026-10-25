import { buildServer } from '../../../backend/src/server.js';
import { FakeAgentRuntime } from '../../../backend/src/acp/fakeRuntime.js';

// Explicit configuration avoids live providers, credentials, and persistent databases.
const { app } = await buildServer({
  runtime: new FakeAgentRuntime(),
  sessionConfig: {},
  config: {
    agentProvider: 'mock',
    host: '127.0.0.1',
    port: 8797,
    allowedOrigins: ['http://127.0.0.1:5183'],
    bobCommand: 'unused',
    bobArgs: '',
    bobWorkspace: 'output/playwright',
    langflowUrl: 'http://127.0.0.1:1',
    snapshotDir: 'output/playwright/snapshots',
    maxInputBytes: 204800,
    retentionDays: 7,
    approvalTtlSeconds: 3600,
    dbPath: ':memory:',
    sessionToken: 'sigap-playwright-local-only',
  },
});
await app.listen({ host: '127.0.0.1', port: 8797 });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => { await app.close(); process.exit(0); });
}
