// Live readiness and read-only flow probe. Never invokes the writer or publishes a document.
import '../src/config.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAgentSessionConfig } from '../src/acp/sessionConfig.js';
import { loadGeminiSettings } from '../src/gemini/config.js';
import {loadOpenAISettings} from '../src/openai/config.js';
import { canonicalToolName } from '../src/acp/toolNames.js';
import { McpHttpClient } from '../src/mcp/httpClient.js';
import { parseSigapReadResult } from '../src/pipeline/toolResults.js';

const output = resolve('../output/testing/langflow-live-probe.json');
const result: Record<string, unknown> = { checked_at: new Date().toISOString(), external_write: false };
let client: McpHttpClient | undefined;
try {
  const provider=process.env.SIGAP_AGENT_PROVIDER==='openai'?'openai':'gemini';
  const settings = provider==='openai'?loadOpenAISettings():loadGeminiSettings();
  result.agent = { provider, model: settings.model, key_configured: !!settings.apiKey };
  const server = loadAgentSessionConfig(provider).mcpServerConfig?.find((s: any) => s.name === 'langflow' && s.type === 'http');
  if (!server) throw new Error('Konfigurasi MCP HTTP Langflow tidak ditemukan.');
  result.endpoint = new URL(server.url).origin;
  client = new McpHttpClient({ url: server.url, headers: Object.fromEntries((server.headers || []).map((h: any) => [h.name, h.value])), timeoutMs: 30000 });
  await client.initialize();
  const tools = await client.listTools();
  result.tools = tools.map(t => ({ name: t.name, canonical: canonicalToolName(t.name), inputSchema: t.inputSchema }));
  const reader = tools.find(t => canonicalToolName(t.name) === 'fetch_shelters');
  if (!reader) throw new Error('Tool fetch_shelters tidak tersedia.');
  const raw = await client.callTool(reader.name, { input_value: JSON.stringify({ action: 'all' }) });
  if (raw.isError) throw new Error('Flow fetch_shelters mengembalikan error.');
  const read = parseSigapReadResult(raw.content.filter(p => p.type === 'text').map(p => p.text || '').join('\n'));
  if (!read) throw new Error('Output fetch_shelters tidak memenuhi kontrak SIGAP.');
  result.read_flow = { status: read.status, record_count: read.records?.length ?? 0, total_shelters: read.total_shelters, verification_status: read.verification_status ?? read.verification?.status };
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = error instanceof Error ? error.message : 'Probe gagal.';
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => {});
  mkdirSync(resolve('../output/testing'), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, output }, null, 2));
}
