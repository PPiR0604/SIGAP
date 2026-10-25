import '../../../backend/src/config.js';
import { buildServer } from '../../../backend/src/server.js';
import { GeminiAgentRuntime } from '../../../backend/src/gemini/runtime.js';
import { loadGeminiSettings } from '../../../backend/src/gemini/config.js';
import { loadAgentSessionConfig } from '../../../backend/src/acp/sessionConfig.js';
import { canonicalToolName } from '../../../backend/src/acp/toolNames.js';
import type { AgentRuntime } from '../../../backend/src/acp/types.js';
import {OpenAICompatibleRuntime} from '../../../backend/src/openai/runtime.js';
import {loadOpenAISettings} from '../../../backend/src/openai/config.js';

const provider=process.env.SIGAP_AGENT_PROVIDER==='openai'?'openai':'gemini';
const runtime = provider==='openai'?new OpenAICompatibleRuntime(loadOpenAISettings()):new GeminiAgentRuntime(loadGeminiSettings());
// Defense in depth: this live test server cannot dispatch write/publication calls,
// even if a model unexpectedly requests them.
const previewRuntime: AgentRuntime = {
  provider,
  model:runtime.model,
  isAvailable: () => runtime.isAvailable(),
  initSession: config => runtime.initSession(config),
  closeSession: id => runtime.closeSession(id),
  readStoredRekap: (id, signal) => runtime.readStoredRekap(id, signal),
  calculateNeedsForSnapshot: (id, reference) => runtime.calculateNeedsForSnapshot(id, reference),
  sendPrompt: (options, onEvent, gate) => runtime.sendPrompt(options, onEvent, async (id, call) => {
    const name = canonicalToolName(call.toolName);
    if (!['fetch_shelters', 'prepare_needs', 'validate_needs', 'calculate_gap', 'flag_anomalies', 'draft_bulletin'].includes(name || '')) return { allow: false, reason: 'Live browser test permits preview only.' };
    if (name === 'draft_bulletin') {
      try {
        const input = JSON.parse(call.args.input_value);
        if (input.confirmed_create_doc || (input.action && input.action !== 'preview')) return { allow: false, reason: 'Document creation is disabled in live tests.' };
      } catch { return { allow: false, reason: 'Invalid bulletin input.' }; }
    }
    return gate ? gate(id, call) : { allow: false, reason: 'Permission gate required.' };
  }),
};
const { app } = await buildServer({
  runtime: previewRuntime,
  sessionConfig: loadAgentSessionConfig(provider),
  config: {
    agentProvider: provider, host: '127.0.0.1', port: 8798,
    allowedOrigins: ['http://127.0.0.1:5184'],
    bobCommand: 'unused', bobArgs: '', bobWorkspace: 'output/playwright-live',
    langflowUrl: 'http://localhost:7860', snapshotDir: 'output/playwright-live/snapshots',
    maxInputBytes: 204800, retentionDays: 7, approvalTtlSeconds: 3600,
    dbPath: ':memory:', sessionToken: 'sigap-playwright-live-local-only',
  },
});
await app.listen({ host: '127.0.0.1', port: 8798 });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => { await app.close(); await runtime.shutdown(); process.exit(0); });
}
