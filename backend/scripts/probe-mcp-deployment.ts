/** Read-only deployment boundary probe. Never submits an authenticated data operation. */
import assert from 'node:assert/strict';
import {McpHttpClient} from '../src/mcp/httpClient.js';
import {validateMcpUrl} from '../src/mcp/urlPolicy.js';

const target = process.argv[2];
const key = process.env.LANGFLOW_API_KEY;
if (!target || !key) throw new Error('Pass the /mcp URL and configure LANGFLOW_API_KEY and, for HTTPS, SIGAP_MCP_ALLOWED_ORIGINS.');
const url = validateMcpUrl(target);
const origin = url.origin;
let healthy = false;
for (let attempt = 0; attempt < 90; attempt++) {
  try {healthy = (await fetch(origin + '/health', {redirect:'error', signal:AbortSignal.timeout(5000)})).ok;} catch {}
  if (healthy) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert(healthy, 'MCP readiness unavailable.');
assert.equal((await fetch(url, {method:'POST',redirect:'error'})).status, 401);
assert.equal((await fetch(origin + '/api/v1/flows/', {redirect:'error'})).status, 404);
const mcp = new McpHttpClient({url:target, headers:{'x-api-key':key}});
try {
  await mcp.initialize();
  const tools = await mcp.listTools();
  assert.equal(tools.length, 7);
  const tool = tools.find(tool => tool.name.endsWith('fetch_shelters'));
  assert(tool, 'fetch_shelters is missing.');
  const result = await mcp.callTool(tool.name, {input_value:'Deployment probe without signed user context'});
  assert.match(JSON.stringify(result), /signed login context/);
  console.log('PASS: healthy MCP, seven tools, API key required, management API hidden, unsigned execution rejected.');
} finally {
  await mcp.close();
}
