// Read and preview only. No writer or document publication.
import '../src/config.js';
import { loadAgentSessionConfig } from '../src/acp/sessionConfig.js';
import { canonicalToolName } from '../src/acp/toolNames.js';
import { McpHttpClient } from '../src/mcp/httpClient.js';
import { parseSigapReadResult, parseBulletinResult } from '../src/pipeline/toolResults.js';

const server = loadAgentSessionConfig('gemini').mcpServerConfig?.find((s: any) => s.name === 'langflow' && s.type === 'http');
if (!server) throw new Error('Konfigurasi MCP tidak ditemukan.');
const client = new McpHttpClient({ url: server.url, headers: Object.fromEntries((server.headers || []).map((h: any) => [h.name, h.value])) });
const text = (raw: { content: Array<{ type: string; text?: string }> }) => raw.content.filter(p => p.type === 'text').map(p => p.text || '').join('\n');
try {
  await client.initialize();
  const tools = await client.listTools();
  const reader = tools.find(t => canonicalToolName(t.name) === 'fetch_shelters');
  const builder = tools.find(t => canonicalToolName(t.name) === 'draft_bulletin');
  if (!reader || !builder) throw new Error('Tool baca/buletin tidak tersedia.');
  const read = parseSigapReadResult(text(await client.callTool(reader.name, { input_value: JSON.stringify({ action: 'all' }) })));
  if (!read.snapshot_id || !read.snapshot_sha256) throw new Error('Pembacaan tidak menghasilkan referensi snapshot.');
  const result = await client.callTool(builder.name, { input_value: JSON.stringify({ action: 'preview', snapshot_id: read.snapshot_id, snapshot_sha256: read.snapshot_sha256, confirmed_create_doc: false }) });
  if (result.isError) throw new Error('Pratinjau buletin gagal.');
  const bulletin = parseBulletinResult(text(result));
  console.log(JSON.stringify({ preview: true, external_write: false, final_lines: bulletin.content.trim().split('\n').slice(-5) }, null, 2));
} finally { await client.close(); }
