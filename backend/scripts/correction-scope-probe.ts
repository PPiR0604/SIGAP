// Standalone Langflow prepare/validate/calculate using synthetic reports. No writer.
import '../src/config.js';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadAgentSessionConfig } from '../src/acp/sessionConfig.js';
import { McpHttpClient } from '../src/mcp/httpClient.js';
import { canonicalToolName } from '../src/acp/toolNames.js';
import { parsePrepareNeedsOutput, parseGapResult } from '../src/pipeline/toolResults.js';

const server = loadAgentSessionConfig('gemini').mcpServerConfig?.find((s: any) => s.name === 'langflow' && s.type === 'http');
if (!server) throw new Error('Konfigurasi MCP tidak tersedia.');
const client = new McpHttpClient({ url: server.url, headers: Object.fromEntries((server.headers || []).map((h: any) => [h.name, h.value])) });
try {
  await client.initialize();
  const tools = await client.listTools();
  async function call(name: string, input: string) {
    const tool = tools.find(t => canonicalToolName(t.name) === name);
    assert.ok(tool, name);
    const raw = await client.callTool(tool.name, { input_value: input });
    assert.ok(!raw.isError, name);
    return raw.content.filter(p => p.type === 'text').map(p => p.text || '').join('\n');
  }
  async function prepare(input: string) {
    const text = await call('prepare_needs', input);
    const marker = /<<<SOURCE_REF>>>(.*?)<<<END_SOURCE_REF>>>/s.exec(text);
    assert.ok(marker, 'Prepare must return a verified SOURCE_REF');
    return JSON.parse(marker[1]);
  }
  const text = '21/10/26 17.00 - Relawan: Posko Uji A, Desa Uji A. Total 10 jiwa: laki-laki 4, perempuan 6. Butuh air bersih.\n21/10/26 17.01 - Relawan: Posko Uji B, Desa Uji B. Total 20 jiwa: laki-laki 9, perempuan 11. Butuh beras.';
  const source = await prepare(text);
  const before = parsePrepareNeedsOutput(await call('validate_needs', JSON.stringify({ ...source, records: [
    { report_id: 'R001', shelter_name: 'Posko Uji A', village: 'Uji A', total_people: 10, male: 4, female: 6, urgent_needs: ['air bersih'] },
    { report_id: 'R002', shelter_name: 'Posko Uji B', village: 'Uji B', total_people: 20, male: 9, female: 11, urgent_needs: ['beras'] },
  ] })));
  assert.equal(before.snapshot_records.length, 2);
  const target = { snapshot_id: before.snapshot_id, snapshot_sha256: before.snapshot_sha256, record_index: 0 };
  const correction = await prepare(JSON.stringify({ report_text: 'Mohon klarifikasi laporan R001 (Posko Uji A): laki-laki: 3. perempuan: 7.', candidate_target: target }));
  const after = parsePrepareNeedsOutput(await call('validate_needs', JSON.stringify({ ...correction, records: [
    { report_id: 'R001', shelter_name: 'Posko Uji A', male: 3, female: 7 },
  ] })));
  const calculation = parseGapResult(await call('calculate_gap', JSON.stringify({ snapshot_id: after.snapshot_id, snapshot_sha256: after.snapshot_sha256 })));
  const summary = { external_write: false, before_count: before.snapshot_records.length, after_count: after.snapshot_records.length, audit_count: after.records.length, calculation_count: calculation.shelters.length,
    villages: after.snapshot_records.map(r => ({ name: r.shelter_name, village: r.village, needs: r.urgent_needs })), checked_at: new Date().toISOString() };
  mkdirSync('../output/testing', { recursive: true });
  writeFileSync('../output/testing/correction-scope-probe.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(after.snapshot_records.length, 2, 'A correction must retain the other village');
  assert.deepEqual(after.snapshot_records[1], before.snapshot_records[1], 'Untouched village must be unchanged');
  assert.equal(calculation.shelters.length, 2);
} finally { await client.close(); }
