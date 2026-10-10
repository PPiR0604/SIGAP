import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { AcpJsonRpcClient } from '../src/acp/client.js';
import { normalizeAcpNotification } from '../src/acp/events.js';
import { AcpProcessRuntime } from '../src/acp/process.js';
import { fileURLToPath } from 'node:url';

test('agent requests cannot resolve client requests with the same JSON-RPC ID', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const client = new AcpJsonRpcClient(input, output, 1000);
  let inbound = 0;
  client.on('agent_request', () => inbound++);
  const pending = client.sendRequest('initialize');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/request_permission', params: {} }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }) + '\n');
  assert.deepEqual(await pending, { protocolVersion: 1 });
  assert.equal(inbound, 1);
  client.destroy(); input.destroy(); output.destroy();
});
test('session/update assistant text uses the ACP content block', () => {
  const events = normalizeAcpNotification('session/update', { sessionId: 'acp-one', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } } }, { sessionId: 'one' });
  assert.equal(events[0]?.event_type, 'assistant_message');
  assert.equal(events[0]?.payload.chunk, 'Hello');
});
test('completed prepare_needs tool output is forwarded as a canonical preview event', () => {
  const events = normalizeAcpNotification('session/update', { sessionId: 'acp-one', update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', name: 'prepare_needs', status: 'completed', rawOutput: { content: [{ type: 'text', text: '{"snapshot_id":"candidate"}' }] } } }, { sessionId: 'one' });
  assert.equal(events[0]?.event_type, 'preview_ready');
  assert.equal(events[0]?.payload.rawOutput, '{"snapshot_id":"candidate"}');
});

test('prepare instructions before SOURCE_REF remain a preparation stage, not a preview', () => {
  const text = 'Instruksi ekstraksi\nLAPORAN POSKO:\n<<<SOURCE_REF>>>{"batch_id":"source","source_sha256":"hash"}<<<END_SOURCE_REF>>>\nLaporan sintetis';
  const events = normalizeAcpNotification('session/update', { update: { sessionUpdate: 'tool_call', toolCallId: 'source', name: 'prepare_needs', status: 'completed', rawOutput: { content: [{ type: 'text', text }] } } }, { sessionId: 'one' });
  assert.equal(events[0]?.event_type, 'stage_changed');
  assert.equal(events[0]?.payload.stage, 'source_prepared');
});

test('validator rejection becomes an actionable error, never a candidate preview',()=>{
  const message='GAGAL: kandidat tidak dapat dikoreksi (Nama posko koreksi tidak cocok dengan baris asal.). Pilih kandidat terbaru.';
  const events=normalizeAcpNotification('session/update',{update:{sessionUpdate:'tool_call',name:'sigap_2_validate_needs',status:'completed',rawOutput:{content:[{type:'text',text:message}]}}},{sessionId:'one'});
  assert.equal(events[0]?.event_type,'error');
  assert.equal(events[0]?.payload.message,message);
});

test('GAGAL in report text after SOURCE_REF does not become a tool error',()=>{
  const text='Instruksi ekstraksi\n<<<SOURCE_REF>>>{"batch_id":"source","source_sha256":"hash"}<<<END_SOURCE_REF>>>\n[R001] waktu=tidak diketahui\nGAGAL: pengiriman obat belum sampai, kebutuhan masih obat.';
  const events=normalizeAcpNotification('session/update',{update:{sessionUpdate:'tool_call',name:'sigap_1_prepare_needs',status:'completed',rawOutput:{content:[{type:'text',text}]}}},{sessionId:'one'});
  assert.equal(events[0]?.event_type,'stage_changed');
  assert.equal(events[0]?.payload.stage,'source_prepared');
});
test('runtime creates ACP sessions and isolates concurrent updates and permissions', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
  const runtime = new AcpProcessRuntime(process.execPath, JSON.stringify([fixture]));
  try {
    await runtime.initSession({ sessionId: 'one', contextId: 'A', mcpServerConfig: [] });
    await runtime.initSession({ sessionId: 'two', contextId: 'B', mcpServerConfig: [] });
    const first: any[] = [], second: any[] = [];
    await Promise.all([
      runtime.sendPrompt({ sessionId: 'one', batchId: 'b1', requestId: 'r1', prompt: 'hello one' }, event => first.push(event), async () => ({ allow: false })),
      runtime.sendPrompt({ sessionId: 'two', batchId: 'b2', requestId: 'r2', prompt: 'hello two' }, event => second.push(event), async () => ({ allow: false }))
    ]);
    assert.deepEqual(first.filter(e => e.event_type === 'assistant_message').map(e => e.payload.chunk), ['hello one']);
    assert.deepEqual(second.filter(e => e.event_type === 'assistant_message').map(e => e.payload.chunk), ['hello two']);
  } finally { await runtime.shutdown?.(); }
});
test('two simultaneous prompts on one ACP session cannot both dispatch', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
  const runtime = new AcpProcessRuntime(process.execPath, JSON.stringify([fixture]));
  let timer: NodeJS.Timeout | undefined;
  try {
    await runtime.initSession({ sessionId: 'one', contextId: 'A', mcpServerConfig: [] });
    timer = setTimeout(() => { void runtime.shutdown?.(); }, 1000);
    const options = { sessionId: 'one', batchId: 'b1', requestId: 'r1', prompt: 'hello' };
    const permission = async () => ({ allow: false });
    const results = await Promise.allSettled([runtime.sendPrompt(options, () => {}, permission), runtime.sendPrompt(options, () => {}, permission)]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.match((results[1] as PromiseRejectedResult).reason.message, /sedang menjalankan/);
  } finally { if(timer)clearTimeout(timer); await runtime.shutdown?.(); }
});
